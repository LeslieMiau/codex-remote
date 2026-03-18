import path from "node:path";

import { openSqliteDatabase, type SqlDatabase } from "../lib/sqlite";

interface CodexNativeThreadMarkerOptions {
  codexHome: string;
  throttleMs?: number;
}

interface NativeThreadRow {
  updated_at: number;
}

interface ThreadColumnRow {
  name: string;
}

function isLockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(targetPath: string) {
  try {
    await import("node:fs/promises").then((fs) => fs.access(targetPath));
    return true;
  } catch {
    return false;
  }
}

export class CodexNativeThreadMarker {
  private readonly databasePath: string;
  private readonly sessionIndexPath: string;
  private readonly throttleMs: number;
  private readonly lastTouchedAt = new Map<string, number>();
  private databasePromise: Promise<SqlDatabase | null> | null = null;
  private hasUserEventColumnPromise: Promise<boolean> | null = null;

  constructor(options: CodexNativeThreadMarkerOptions) {
    this.databasePath = path.join(options.codexHome, "state_5.sqlite");
    this.sessionIndexPath = path.join(options.codexHome, "session_index.jsonl");
    this.throttleMs = options.throttleMs ?? 300;
  }

  async touchThread(
    threadId: string,
    input: {
      markUserEvent?: boolean;
      force?: boolean;
    } = {}
  ) {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      return false;
    }

    const now = Date.now();
    const lastTouched = this.lastTouchedAt.get(normalizedThreadId) ?? 0;
    if (!input.force && now - lastTouched < this.throttleMs) {
      return false;
    }

    const database = await this.getDatabase();
    if (!database) {
      return false;
    }

    const existing = database
      .prepare("SELECT updated_at FROM threads WHERE id = ?")
      .get<NativeThreadRow>(normalizedThreadId);
    if (!existing) {
      return false;
    }

    const currentSeconds = Math.floor(now / 1_000);
    const nextUpdatedAt = Math.max(
      currentSeconds,
      Number(existing.updated_at ?? 0) + 1
    );
    const markUserEvent =
      input.markUserEvent && (await this.supportsHasUserEventColumn(database));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        if (markUserEvent) {
          database
            .prepare(
              `UPDATE threads
                 SET updated_at = ?,
                     has_user_event = CASE WHEN has_user_event = 0 THEN 1 ELSE has_user_event END
               WHERE id = ?`
            )
            .run(nextUpdatedAt, normalizedThreadId);
        } else {
          database
            .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
            .run(nextUpdatedAt, normalizedThreadId);
        }
        await this.checkpointWal(database);
        await this.touchSessionIndex(now);
        this.lastTouchedAt.set(normalizedThreadId, now);
        return true;
      } catch (error) {
        if (!isLockError(error) || attempt === 4) {
          throw error;
        }
        await sleep(120 * (attempt + 1));
      }
    }

    return false;
  }

  async close() {
    const database = await this.getDatabase();
    database?.close();
    this.databasePromise = null;
  }

  private async getDatabase() {
    if (!this.databasePromise) {
      this.databasePromise = (async () => {
        if (!(await pathExists(this.databasePath))) {
          return null;
        }
        const database = await openSqliteDatabase(this.databasePath, {
          readonly: false,
          fileMustExist: true
        });
        database.exec("PRAGMA busy_timeout = 3000;");
        return database;
      })();
    }

    return this.databasePromise;
  }

  private async supportsHasUserEventColumn(database: SqlDatabase) {
    if (!this.hasUserEventColumnPromise) {
      this.hasUserEventColumnPromise = Promise.resolve(
        database
          .prepare("PRAGMA table_info(threads)")
          .all<ThreadColumnRow>()
          .some((column) => column.name === "has_user_event")
      );
    }

    return this.hasUserEventColumnPromise;
  }

  private async checkpointWal(database: SqlDatabase) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        database.prepare("PRAGMA wal_checkpoint(PASSIVE);").all();
        return;
      } catch (error) {
        if (!isLockError(error) || attempt === 2) {
          return;
        }
        await sleep(60 * (attempt + 1));
      }
    }
  }

  private async touchSessionIndex(nowMs: number) {
    if (!(await pathExists(this.sessionIndexPath))) {
      return;
    }

    const fs = await import("node:fs/promises");
    const timestamp = new Date(nowMs);
    try {
      await fs.utimes(this.sessionIndexPath, timestamp, timestamp);
    } catch {
      // Best-effort only. Some Codex installs may not keep a session index file updated.
    }
  }
}
