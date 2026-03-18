import type { DatabaseSync, StatementSync } from "node:sqlite";

export interface SqlStatement {
  run(...params: unknown[]): {
    changes?: number | bigint;
    lastInsertRowid?: number | bigint;
  };
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(...params: unknown[]): T[];
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

class NodeSqliteStatement implements SqlStatement {
  constructor(private readonly statement: StatementSync) {}

  run(...params: unknown[]) {
    return this.statement.run(...(params as never[]));
  }

  get<T = Record<string, unknown>>(...params: unknown[]) {
    return this.statement.get(...(params as never[])) as T | undefined;
  }

  all<T = Record<string, unknown>>(...params: unknown[]) {
    return this.statement.all(...(params as never[])) as T[];
  }
}

class NodeSqliteDatabase implements SqlDatabase {
  constructor(private readonly database: DatabaseSync) {}

  exec(sql: string) {
    this.database.exec(sql);
  }

  prepare(sql: string) {
    return new NodeSqliteStatement(this.database.prepare(sql));
  }

  close() {
    this.database.close();
  }
}

const nodeSqliteSpecifier = "node:sqlite";

function loadNodeSqlite(): Promise<typeof import("node:sqlite")> {
  return import(nodeSqliteSpecifier);
}

interface OpenSqliteDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

export async function openSqliteDatabase(
  filename: string,
  options: OpenSqliteDatabaseOptions = {}
): Promise<SqlDatabase> {
  try {
    const module = await import("better-sqlite3");
    const BetterSqliteDatabase = module.default;
    const database = new BetterSqliteDatabase(filename, {
      readonly: Boolean(options.readonly),
      fileMustExist: Boolean(options.fileMustExist ?? options.readonly)
    });
    if (!options.readonly) {
      database.pragma("journal_mode = WAL");
    }
    return database as unknown as SqlDatabase;
  } catch {
    const module = await loadNodeSqlite();
    const database = new module.DatabaseSync(
      filename,
      {
        open: true,
        readOnly: Boolean(options.readonly)
      } as ConstructorParameters<typeof module.DatabaseSync>[1]
    );
    if (!options.readonly) {
      database.exec("PRAGMA journal_mode = WAL;");
    }
    return new NodeSqliteDatabase(database);
  }
}

export async function openReadOnlySqliteDatabase(filename: string): Promise<SqlDatabase> {
  return openSqliteDatabase(filename, {
    readonly: true,
    fileMustExist: true
  });
}
