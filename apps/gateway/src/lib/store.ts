import type {
  ApprovalRequest,
  CodexLiveState,
  DeduplicationKey,
  GatewayEvent,
  NativeRequestRecord,
  PatchRecord,
  ProjectSummary,
  ThreadDetail,
  ThreadSnapshot,
  TurnRecord
} from "@codex-remote/protocol";

import { openSqliteDatabase, type SqlDatabase } from "./sqlite";
import { nowIso } from "./time";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "bigint") {
    return value !== 0n;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return false;
}

function mapThread(row: Record<string, unknown> | undefined): ThreadSnapshot | undefined {
  if (!row) {
    return undefined;
  }

  return {
    project_id: String(row.project_id),
    thread_id: String(row.thread_id),
    state: row.state as ThreadSnapshot["state"],
    active_turn_id: row.active_turn_id ? String(row.active_turn_id) : null,
    pending_turn_ids: parseJson(String(row.pending_turn_ids ?? "[]"), []),
    pending_approval_ids: parseJson(String(row.pending_approval_ids ?? "[]"), []),
    worktree_path: row.worktree_path ? String(row.worktree_path) : undefined,
    adapter_kind: row.adapter_kind
      ? (String(row.adapter_kind) as ThreadSnapshot["adapter_kind"])
      : undefined,
    adapter_thread_ref: row.adapter_thread_ref
      ? String(row.adapter_thread_ref)
      : undefined,
    native_title: row.native_title ? String(row.native_title) : undefined,
    native_archived:
      typeof row.native_archived === "undefined"
        ? undefined
        : toBoolean(row.native_archived),
    native_status_type: row.native_status_type ? String(row.native_status_type) : undefined,
    native_active_flags: parseJson(
      row.native_active_flags ? String(row.native_active_flags) : "[]",
      []
    ),
    native_turn_ref: row.native_turn_ref ? String(row.native_turn_ref) : undefined,
    native_token_usage: parseJson(
      row.native_token_usage_json ? String(row.native_token_usage_json) : undefined,
      undefined
    ),
    last_stream_seq: Number(row.last_stream_seq ?? 0),
    created_at: row.created_at ? String(row.created_at) : undefined,
    cleanup_after: row.cleanup_after ? String(row.cleanup_after) : undefined,
    updated_at: String(row.updated_at)
  };
}

function mapProject(row: Record<string, unknown> | undefined): ProjectSummary | undefined {
  if (!row) {
    return undefined;
  }

  return {
    project_id: String(row.project_id),
    repo_root: String(row.repo_root),
    default_branch: row.default_branch ? String(row.default_branch) : undefined,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined
  };
}

function mapTurn(row: Record<string, unknown>): TurnRecord {
  return {
    project_id: String(row.project_id),
    thread_id: String(row.thread_id),
    turn_id: String(row.turn_id),
    prompt: String(row.prompt),
    state: row.state as TurnRecord["state"],
    summary: row.summary ? String(row.summary) : undefined,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function mapApproval(row: Record<string, unknown>): ApprovalRequest {
  return {
    approval_id: String(row.approval_id),
    project_id: row.project_id ? String(row.project_id) : undefined,
    thread_id: row.thread_id ? String(row.thread_id) : undefined,
    turn_id: row.turn_id ? String(row.turn_id) : undefined,
    kind: row.kind as ApprovalRequest["kind"],
    source: row.source ? (String(row.source) as ApprovalRequest["source"]) : "legacy_gateway",
    native_ref: row.native_ref ? String(row.native_ref) : undefined,
    title: row.title ? String(row.title) : undefined,
    status: row.status as ApprovalRequest["status"],
    reason: String(row.reason),
    requested_at: String(row.requested_at),
    expires_at: row.expires_at ? String(row.expires_at) : undefined,
    resolved_at: row.resolved_at ? String(row.resolved_at) : undefined,
    actor_id: row.actor_id ? String(row.actor_id) : undefined,
    recoverable:
      typeof row.recoverable === "undefined" ? true : toBoolean(row.recoverable),
    command: row.command ? String(row.command) : undefined,
    cwd: row.cwd ? String(row.cwd) : undefined,
    permissions: parseJson(
      row.permissions_json ? String(row.permissions_json) : undefined,
      undefined
    ),
    available_decisions: parseJson(
      row.available_decisions_json ? String(row.available_decisions_json) : "[]",
      []
    )
  };
}

function mapPatch(row: Record<string, unknown>): PatchRecord {
  return {
    patch_id: String(row.patch_id),
    project_id: String(row.project_id),
    thread_id: String(row.thread_id),
    turn_id: String(row.turn_id),
    status: row.status as PatchRecord["status"],
    summary: String(row.summary),
    files: parseJson(String(row.files_json ?? "[]"), []),
    test_summary: row.test_summary ? String(row.test_summary) : undefined,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    applied_at: row.applied_at ? String(row.applied_at) : undefined,
    discarded_at: row.discarded_at ? String(row.discarded_at) : undefined,
    rollback_available: toBoolean(row.rollback_available),
    changes: parseJson(String(row.changes_json ?? "[]"), [])
  };
}

function mapNativeRequest(row: Record<string, unknown>): NativeRequestRecord {
  return {
    native_request_id: String(row.native_request_id),
    project_id: row.project_id ? String(row.project_id) : undefined,
    thread_id: row.thread_id ? String(row.thread_id) : undefined,
    turn_id: row.turn_id ? String(row.turn_id) : undefined,
    item_id: row.item_id ? String(row.item_id) : undefined,
    kind: row.kind as NativeRequestRecord["kind"],
    source: row.source ? "native" : "native",
    native_ref: row.native_ref ? String(row.native_ref) : undefined,
    title: row.title ? String(row.title) : undefined,
    prompt: row.prompt ? String(row.prompt) : undefined,
    status: row.status as NativeRequestRecord["status"],
    payload: parseJson(row.payload_json ? String(row.payload_json) : undefined, undefined),
    response_payload: parseJson(
      row.response_payload_json ? String(row.response_payload_json) : undefined,
      undefined
    ),
    requested_at: String(row.requested_at),
    resolved_at: row.resolved_at ? String(row.resolved_at) : undefined,
    actor_id: row.actor_id ? String(row.actor_id) : undefined
  };
}

function mapEvent(row: Record<string, unknown>): GatewayEvent {
  return {
    event_id: String(row.event_id),
    stream_seq: Number(row.stream_seq),
    schema_version: String(row.schema_version),
    event_type: row.event_type as GatewayEvent["event_type"],
    project_id: String(row.project_id),
    thread_id: String(row.thread_id),
    turn_id: row.turn_id ? String(row.turn_id) : undefined,
    timestamp: String(row.timestamp),
    payload: parseJson(String(row.payload_json), {})
  } as GatewayEvent;
}

function mapLiveState(
  row: Record<string, unknown> | undefined
): CodexLiveState | undefined {
  if (!row) {
    return undefined;
  }

  return {
    turn_id: row.turn_id ? String(row.turn_id) : undefined,
    status: String(row.status),
    detail: row.detail ? String(row.detail) : undefined,
    assistant_text: row.assistant_text ? String(row.assistant_text) : "",
    details: parseJson(row.details_json ? String(row.details_json) : "[]", []),
    updated_at: String(row.updated_at),
    awaiting_native_commit: toBoolean(row.awaiting_native_commit)
  };
}

export class GatewayStore {
  private constructor(
    private readonly database: SqlDatabase,
    readonly filename: string
  ) {}

  static async open(filename = ":memory:"): Promise<GatewayStore> {
    const database = await openSqliteDatabase(filename);
    const store = new GatewayStore(database, filename);
    store.migrate();
    return store;
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        repo_root TEXT NOT NULL,
        default_branch TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_snapshots (
        thread_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        state TEXT NOT NULL,
        active_turn_id TEXT,
        pending_turn_ids TEXT NOT NULL,
        pending_approval_ids TEXT NOT NULL,
        worktree_path TEXT,
        adapter_kind TEXT,
        adapter_thread_ref TEXT,
        native_title TEXT,
        native_archived INTEGER NOT NULL DEFAULT 0,
        native_status_type TEXT,
        native_active_flags TEXT NOT NULL DEFAULT '[]',
        native_turn_ref TEXT,
        native_token_usage_json TEXT,
        last_stream_seq INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        cleanup_after TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        collaboration_mode TEXT,
        state TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        project_id TEXT,
        thread_id TEXT,
        turn_id TEXT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'legacy_gateway',
        native_ref TEXT,
        title TEXT,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        expires_at TEXT,
        resolved_at TEXT,
        actor_id TEXT,
        recoverable INTEGER NOT NULL DEFAULT 1,
        command TEXT,
        cwd TEXT,
        permissions_json TEXT,
        available_decisions_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS native_requests (
        native_request_id TEXT PRIMARY KEY,
        project_id TEXT,
        thread_id TEXT,
        turn_id TEXT,
        item_id TEXT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'native',
        native_ref TEXT,
        title TEXT,
        prompt TEXT,
        status TEXT NOT NULL,
        payload_json TEXT,
        response_payload_json TEXT,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        actor_id TEXT
      );

      CREATE TABLE IF NOT EXISTS patches (
        patch_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        files_json TEXT NOT NULL,
        test_summary TEXT,
        changes_json TEXT NOT NULL,
        rollback_available INTEGER NOT NULL DEFAULT 0,
        applied_at TEXT,
        discarded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        stream_seq INTEGER NOT NULL,
        schema_version TEXT NOT NULL,
        event_type TEXT NOT NULL,
        project_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS events_thread_seq_idx
      ON events(thread_id, stream_seq);

      CREATE TABLE IF NOT EXISTS thread_live_state (
        thread_id TEXT PRIMARY KEY,
        turn_id TEXT,
        status TEXT NOT NULL,
        detail TEXT,
        assistant_text TEXT,
        details_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        awaiting_native_commit INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS command_dedup (
        actor_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(actor_id, request_id, command_type)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        project_id TEXT,
        thread_id TEXT,
        turn_id TEXT,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      );
    `);

    this.ensureThreadSnapshotColumn("adapter_kind", "TEXT");
    this.ensureThreadSnapshotColumn("adapter_thread_ref", "TEXT");
    this.ensureThreadSnapshotColumn("native_title", "TEXT");
    this.ensureThreadSnapshotColumn("native_archived", "INTEGER NOT NULL DEFAULT 0");
    this.ensureThreadSnapshotColumn("native_status_type", "TEXT");
    this.ensureThreadSnapshotColumn("native_active_flags", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureThreadSnapshotColumn("native_turn_ref", "TEXT");
    this.ensureThreadSnapshotColumn("native_token_usage_json", "TEXT");
    this.ensureTurnColumn("collaboration_mode", "TEXT");
    this.ensureApprovalColumn("source", "TEXT NOT NULL DEFAULT 'legacy_gateway'");
    this.ensureApprovalColumn("native_ref", "TEXT");
    this.ensureApprovalColumn("title", "TEXT");
    this.ensureApprovalColumn("recoverable", "INTEGER NOT NULL DEFAULT 1");
    this.ensureApprovalColumn("command", "TEXT");
    this.ensureApprovalColumn("cwd", "TEXT");
    this.ensureApprovalColumn("permissions_json", "TEXT");
    this.ensureApprovalColumn("available_decisions_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureLiveStateColumn("detail", "TEXT");
  }

  private ensureColumn(table: string, name: string, type: string) {
    const columns = this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all<Record<string, unknown>>();
    const hasColumn = columns.some((row) => String(row.name) === name);
    if (!hasColumn) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }

  private ensureThreadSnapshotColumn(name: string, type: string) {
    this.ensureColumn("thread_snapshots", name, type);
  }

  private ensureTurnColumn(name: string, type: string) {
    this.ensureColumn("turns", name, type);
  }

  private ensureApprovalColumn(name: string, type: string) {
    this.ensureColumn("approvals", name, type);
  }

  private ensureLiveStateColumn(name: string, type: string) {
    this.ensureColumn("thread_live_state", name, type);
  }

  close() {
    this.database.close();
  }

  saveProject(project: ProjectSummary): ProjectSummary {
    const timestamp = project.updated_at ?? nowIso();
    const createdAt = project.created_at ?? timestamp;
    this.database
      .prepare(`
        INSERT INTO projects(project_id, repo_root, default_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          repo_root = excluded.repo_root,
          default_branch = COALESCE(excluded.default_branch, projects.default_branch),
          updated_at = excluded.updated_at
      `)
      .run(
        project.project_id,
        project.repo_root,
        project.default_branch ?? null,
        createdAt,
        timestamp
      );

    return {
      ...project,
      created_at: createdAt,
      updated_at: timestamp
    };
  }

  getProject(projectId: string): ProjectSummary | undefined {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE project_id = ?")
      .get<Record<string, unknown>>(projectId);
    return mapProject(row);
  }

  listProjects(): ProjectSummary[] {
    return this.database
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all<Record<string, unknown>>()
      .map((row) => mapProject(row))
      .filter((project): project is ProjectSummary => Boolean(project));
  }

  saveThread(snapshot: ThreadSnapshot): ThreadSnapshot {
    const timestamp = snapshot.updated_at ?? nowIso();
    const createdAt = snapshot.created_at ?? timestamp;
    this.database
      .prepare(`
        INSERT INTO thread_snapshots(
          thread_id, project_id, state, active_turn_id, pending_turn_ids,
          pending_approval_ids, worktree_path, adapter_kind, adapter_thread_ref,
          native_title, native_archived, native_status_type, native_active_flags,
          native_turn_ref, native_token_usage_json, last_stream_seq, created_at,
          cleanup_after, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          project_id = excluded.project_id,
          state = excluded.state,
          active_turn_id = excluded.active_turn_id,
          pending_turn_ids = excluded.pending_turn_ids,
          pending_approval_ids = excluded.pending_approval_ids,
          worktree_path = excluded.worktree_path,
          adapter_kind = excluded.adapter_kind,
          adapter_thread_ref = excluded.adapter_thread_ref,
          native_title = excluded.native_title,
          native_archived = excluded.native_archived,
          native_status_type = excluded.native_status_type,
          native_active_flags = excluded.native_active_flags,
          native_turn_ref = excluded.native_turn_ref,
          native_token_usage_json = excluded.native_token_usage_json,
          last_stream_seq = excluded.last_stream_seq,
          cleanup_after = excluded.cleanup_after,
          updated_at = excluded.updated_at
      `)
      .run(
        snapshot.thread_id,
        snapshot.project_id,
        snapshot.state,
        snapshot.active_turn_id ?? null,
        serialize(snapshot.pending_turn_ids),
        serialize(snapshot.pending_approval_ids),
        snapshot.worktree_path ?? null,
        snapshot.adapter_kind ?? null,
        snapshot.adapter_thread_ref ?? null,
        snapshot.native_title ?? null,
        snapshot.native_archived ? 1 : 0,
        snapshot.native_status_type ?? null,
        serialize(snapshot.native_active_flags ?? []),
        snapshot.native_turn_ref ?? null,
        snapshot.native_token_usage ? serialize(snapshot.native_token_usage) : null,
        snapshot.last_stream_seq,
        createdAt,
        snapshot.cleanup_after ?? null,
        timestamp
      );

    return {
      ...snapshot,
      created_at: createdAt,
      updated_at: timestamp
    };
  }

  getThread(threadId: string): ThreadSnapshot | undefined {
    return mapThread(
      this.database
        .prepare("SELECT * FROM thread_snapshots WHERE thread_id = ?")
        .get<Record<string, unknown>>(threadId)
    );
  }

  findThreadByAdapterRef(adapterThreadRef: string): ThreadSnapshot | undefined {
    return mapThread(
      this.database
        .prepare("SELECT * FROM thread_snapshots WHERE adapter_thread_ref = ?")
        .get<Record<string, unknown>>(adapterThreadRef)
    );
  }

  renameThread(oldThreadId: string, newThreadId: string): ThreadSnapshot {
    if (oldThreadId === newThreadId) {
      const existing = this.getThread(oldThreadId);
      if (!existing) {
        throw new Error(`Unknown thread ${oldThreadId}`);
      }
      return existing;
    }

    const current = this.getThread(oldThreadId);
    if (!current) {
      throw new Error(`Unknown thread ${oldThreadId}`);
    }
    if (this.getThread(newThreadId)) {
      throw new Error(`Thread ${newThreadId} already exists`);
    }

    this.database.exec("BEGIN IMMEDIATE TRANSACTION");

    try {
      this.database
        .prepare(
          `
            INSERT INTO thread_snapshots(
              thread_id, project_id, state, active_turn_id, pending_turn_ids,
              pending_approval_ids, worktree_path, adapter_kind, adapter_thread_ref,
              native_title, native_archived, native_status_type, native_active_flags,
              native_turn_ref, native_token_usage_json, last_stream_seq, created_at,
              cleanup_after, updated_at
            )
            SELECT
              ?, project_id, state, active_turn_id, pending_turn_ids,
              pending_approval_ids, worktree_path, adapter_kind, adapter_thread_ref,
              native_title, native_archived, native_status_type, native_active_flags,
              native_turn_ref, native_token_usage_json, last_stream_seq, created_at,
              cleanup_after, updated_at
            FROM thread_snapshots
            WHERE thread_id = ?
          `
        )
        .run(newThreadId, oldThreadId);

      this.database
        .prepare("DELETE FROM thread_snapshots WHERE thread_id = ?")
        .run(oldThreadId);

      for (const table of [
        "turns",
        "approvals",
        "native_requests",
        "patches",
        "events",
        "audit_logs",
        "thread_live_state"
      ]) {
        const column = table === "thread_live_state" ? "thread_id" : "thread_id";
        this.database
          .prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`)
          .run(newThreadId, oldThreadId);
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    const renamed = this.getThread(newThreadId);
    if (!renamed) {
      throw new Error(`Failed to rename thread ${oldThreadId} to ${newThreadId}`);
    }
    return renamed;
  }

  deleteThread(threadId: string) {
    this.database.exec("BEGIN IMMEDIATE TRANSACTION");

    try {
      for (const table of [
        "thread_live_state",
        "events",
        "patches",
        "native_requests",
        "approvals",
        "turns",
        "audit_logs",
        "thread_snapshots"
      ]) {
        this.database
          .prepare(`DELETE FROM ${table} WHERE thread_id = ?`)
          .run(threadId);
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listThreads(projectId?: string): ThreadSnapshot[] {
    const statement = projectId
      ? this.database.prepare(
          "SELECT * FROM thread_snapshots WHERE project_id = ? ORDER BY updated_at DESC"
        )
      : this.database.prepare(
          "SELECT * FROM thread_snapshots ORDER BY updated_at DESC"
        );

    const rows = projectId
      ? statement.all<Record<string, unknown>>(projectId)
      : statement.all<Record<string, unknown>>();

    return rows
      .map((row) => mapThread(row))
      .filter((thread): thread is ThreadSnapshot => Boolean(thread));
  }

  saveTurn(turn: TurnRecord): TurnRecord {
    const collaborationMode =
      "collaboration_mode" in turn
        ? ((turn as Record<string, unknown>).collaboration_mode ?? null)
        : null;

    this.database
      .prepare(`
        INSERT INTO turns(
          turn_id, project_id, thread_id, prompt, collaboration_mode, state, summary, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(turn_id) DO UPDATE SET
          state = excluded.state,
          summary = excluded.summary,
          collaboration_mode = COALESCE(excluded.collaboration_mode, turns.collaboration_mode),
          updated_at = excluded.updated_at
      `)
      .run(
        turn.turn_id,
        turn.project_id,
        turn.thread_id,
        turn.prompt,
        collaborationMode,
        turn.state,
        turn.summary ?? null,
        turn.created_at,
        turn.updated_at
      );

    return turn;
  }

  getTurn(turnId: string): TurnRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM turns WHERE turn_id = ?")
      .get<Record<string, unknown>>(turnId);

    return row ? mapTurn(row) : undefined;
  }

  listTurns(threadId: string): TurnRecord[] {
    return this.database
      .prepare("SELECT * FROM turns WHERE thread_id = ? ORDER BY created_at ASC")
      .all<Record<string, unknown>>(threadId)
      .map(mapTurn);
  }

  listQueuedTurns(limit = 100): TurnRecord[] {
    return this.database
      .prepare(
        "SELECT * FROM turns WHERE state = 'queued' ORDER BY created_at ASC LIMIT ?"
      )
      .all<Record<string, unknown>>(limit)
      .map(mapTurn);
  }

  saveApproval(approval: ApprovalRequest): ApprovalRequest {
    this.database
      .prepare(`
        INSERT INTO approvals(
          approval_id, project_id, thread_id, turn_id, kind, source, native_ref, title,
          status, reason, requested_at, expires_at, resolved_at, actor_id, recoverable,
          command, cwd, permissions_json, available_decisions_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(approval_id) DO UPDATE SET
          project_id = excluded.project_id,
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          kind = excluded.kind,
          source = excluded.source,
          native_ref = excluded.native_ref,
          title = excluded.title,
          status = excluded.status,
          reason = excluded.reason,
          expires_at = excluded.expires_at,
          resolved_at = excluded.resolved_at,
          actor_id = excluded.actor_id,
          recoverable = excluded.recoverable,
          command = excluded.command,
          cwd = excluded.cwd,
          permissions_json = excluded.permissions_json,
          available_decisions_json = excluded.available_decisions_json
      `)
      .run(
        approval.approval_id,
        approval.project_id ?? null,
        approval.thread_id ?? null,
        approval.turn_id ?? null,
        approval.kind,
        approval.source ?? "legacy_gateway",
        approval.native_ref ?? null,
        approval.title ?? null,
        approval.status,
        approval.reason,
        approval.requested_at,
        approval.expires_at ?? null,
        approval.resolved_at ?? null,
        approval.actor_id ?? null,
        approval.recoverable === false ? 0 : 1,
        approval.command ?? null,
        approval.cwd ?? null,
        approval.permissions ? serialize(approval.permissions) : null,
        serialize(approval.available_decisions ?? [])
      );

    return approval;
  }

  getApproval(approvalId: string): ApprovalRequest | undefined {
    const row = this.database
      .prepare("SELECT * FROM approvals WHERE approval_id = ?")
      .get<Record<string, unknown>>(approvalId);

    return row ? mapApproval(row) : undefined;
  }

  listApprovals(threadId: string): ApprovalRequest[] {
    return this.database
      .prepare("SELECT * FROM approvals WHERE thread_id = ? ORDER BY requested_at ASC")
      .all<Record<string, unknown>>(threadId)
      .map(mapApproval);
  }

  listExpirableApprovals(now: string): ApprovalRequest[] {
    return this.database
      .prepare(
        "SELECT * FROM approvals WHERE status = 'requested' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC"
      )
      .all<Record<string, unknown>>(now)
      .map(mapApproval);
  }

  saveNativeRequest(request: NativeRequestRecord): NativeRequestRecord {
    this.database
      .prepare(`
        INSERT INTO native_requests(
          native_request_id, project_id, thread_id, turn_id, item_id, kind, source, native_ref,
          title, prompt, status, payload_json, response_payload_json, requested_at, resolved_at, actor_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(native_request_id) DO UPDATE SET
          project_id = excluded.project_id,
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          item_id = excluded.item_id,
          kind = excluded.kind,
          source = excluded.source,
          native_ref = excluded.native_ref,
          title = excluded.title,
          prompt = excluded.prompt,
          status = excluded.status,
          payload_json = excluded.payload_json,
          response_payload_json = excluded.response_payload_json,
          resolved_at = excluded.resolved_at,
          actor_id = excluded.actor_id
      `)
      .run(
        request.native_request_id,
        request.project_id ?? null,
        request.thread_id ?? null,
        request.turn_id ?? null,
        request.item_id ?? null,
        request.kind,
        request.source ?? "native",
        request.native_ref ?? null,
        request.title ?? null,
        request.prompt ?? null,
        request.status,
        request.payload ? serialize(request.payload) : null,
        typeof request.response_payload === "undefined"
          ? null
          : serialize(request.response_payload),
        request.requested_at,
        request.resolved_at ?? null,
        request.actor_id ?? null
      );

    return request;
  }

  getNativeRequest(nativeRequestId: string): NativeRequestRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM native_requests WHERE native_request_id = ?")
      .get<Record<string, unknown>>(nativeRequestId);

    return row ? mapNativeRequest(row) : undefined;
  }

  listNativeRequests(threadId: string): NativeRequestRecord[] {
    return this.database
      .prepare("SELECT * FROM native_requests WHERE thread_id = ? ORDER BY requested_at ASC")
      .all<Record<string, unknown>>(threadId)
      .map(mapNativeRequest);
  }

  savePatch(patch: PatchRecord): PatchRecord {
    this.database
      .prepare(`
        INSERT INTO patches(
          patch_id, project_id, thread_id, turn_id, status, summary, files_json,
          test_summary, changes_json, rollback_available, applied_at, discarded_at,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(patch_id) DO UPDATE SET
          status = excluded.status,
          summary = excluded.summary,
          files_json = excluded.files_json,
          test_summary = excluded.test_summary,
          changes_json = excluded.changes_json,
          rollback_available = excluded.rollback_available,
          applied_at = excluded.applied_at,
          discarded_at = excluded.discarded_at,
          updated_at = excluded.updated_at
      `)
      .run(
        patch.patch_id,
        patch.project_id,
        patch.thread_id,
        patch.turn_id,
        patch.status,
        patch.summary,
        serialize(patch.files),
        patch.test_summary ?? null,
        serialize(patch.changes),
        patch.rollback_available ? 1 : 0,
        patch.applied_at ?? null,
        patch.discarded_at ?? null,
        patch.created_at,
        patch.updated_at
      );

    return patch;
  }

  getPatch(patchId: string): PatchRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM patches WHERE patch_id = ?")
      .get<Record<string, unknown>>(patchId);

    return row ? mapPatch(row) : undefined;
  }

  listPatches(threadId: string): PatchRecord[] {
    return this.database
      .prepare("SELECT * FROM patches WHERE thread_id = ? ORDER BY created_at ASC")
      .all<Record<string, unknown>>(threadId)
      .map(mapPatch);
  }

  saveLiveState(threadId: string, state: CodexLiveState): CodexLiveState {
    this.database
      .prepare(`
        INSERT INTO thread_live_state(
          thread_id, turn_id, status, detail, assistant_text, details_json, updated_at, awaiting_native_commit
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          turn_id = excluded.turn_id,
          status = excluded.status,
          detail = excluded.detail,
          assistant_text = excluded.assistant_text,
          details_json = excluded.details_json,
          updated_at = excluded.updated_at,
          awaiting_native_commit = excluded.awaiting_native_commit
      `)
      .run(
        threadId,
        state.turn_id ?? null,
        state.status,
        state.detail ?? null,
        state.assistant_text,
        serialize(state.details ?? []),
        state.updated_at,
        state.awaiting_native_commit ? 1 : 0
      );

    return state;
  }

  getLiveState(threadId: string): CodexLiveState | undefined {
    const row = this.database
      .prepare("SELECT * FROM thread_live_state WHERE thread_id = ?")
      .get<Record<string, unknown>>(threadId);

    return mapLiveState(row);
  }

  clearLiveState(threadId: string) {
    this.database
      .prepare("DELETE FROM thread_live_state WHERE thread_id = ?")
      .run(threadId);
  }

  appendEvent(event: GatewayEvent): GatewayEvent {
    this.database
      .prepare(`
        INSERT INTO events(
          event_id, stream_seq, schema_version, event_type, project_id,
          thread_id, turn_id, timestamp, payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.event_id,
        event.stream_seq,
        event.schema_version,
        event.event_type,
        event.project_id,
        event.thread_id,
        event.turn_id ?? null,
        event.timestamp,
        serialize(event.payload)
      );

    return event;
  }

  nextStreamSeq(threadId: string): number {
    const row = this.database
      .prepare("SELECT last_stream_seq FROM thread_snapshots WHERE thread_id = ?")
      .get<{ last_stream_seq: number }>(threadId);

    return Number(row?.last_stream_seq ?? 0) + 1;
  }

  listEvents(threadId: string, afterSeq = 0, limit = 500): GatewayEvent[] {
    return this.database
      .prepare(
        "SELECT * FROM events WHERE thread_id = ? AND stream_seq > ? ORDER BY stream_seq ASC LIMIT ?"
      )
      .all<Record<string, unknown>>(threadId, afterSeq, limit)
      .map(mapEvent);
  }

  saveCommandResult(key: DeduplicationKey, response: unknown) {
    this.database
      .prepare(`
        INSERT INTO command_dedup(actor_id, request_id, command_type, response_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(actor_id, request_id, command_type) DO UPDATE SET
          response_json = excluded.response_json
      `)
      .run(
        key.actor_id,
        key.request_id,
        key.command_type,
        serialize(response),
        nowIso()
      );
  }

  getCommandResult<T>(key: DeduplicationKey): T | undefined {
    const row = this.database
      .prepare(
        "SELECT response_json FROM command_dedup WHERE actor_id = ? AND request_id = ? AND command_type = ?"
      )
      .get<{ response_json: string }>(
        key.actor_id,
        key.request_id,
        key.command_type
      );

    return row ? (JSON.parse(row.response_json) as T) : undefined;
  }

  appendAudit(input: {
    category: string;
    message: string;
    project_id?: string;
    thread_id?: string;
    turn_id?: string;
    details?: Record<string, unknown>;
  }) {
    this.database
      .prepare(`
        INSERT INTO audit_logs(category, project_id, thread_id, turn_id, message, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.category,
        input.project_id ?? null,
        input.thread_id ?? null,
        input.turn_id ?? null,
        input.message,
        input.details ? serialize(input.details) : null,
        nowIso()
      );
  }

  listAuditLogs(threadId?: string) {
    const statement = threadId
      ? this.database.prepare(
          "SELECT * FROM audit_logs WHERE thread_id = ? ORDER BY audit_id ASC"
        )
      : this.database.prepare("SELECT * FROM audit_logs ORDER BY audit_id ASC");

    const rows = threadId
      ? statement.all<Record<string, unknown>>(threadId)
      : statement.all<Record<string, unknown>>();

    return rows.map((row) => ({
      audit_id: Number(row.audit_id),
      category: String(row.category),
      project_id: row.project_id ? String(row.project_id) : undefined,
      thread_id: row.thread_id ? String(row.thread_id) : undefined,
      turn_id: row.turn_id ? String(row.turn_id) : undefined,
      message: String(row.message),
      details: parseJson(row.details_json ? String(row.details_json) : "{}", {}),
      created_at: String(row.created_at)
    }));
  }

  getCapacity() {
    const activeRow = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM thread_snapshots WHERE active_turn_id IS NOT NULL"
      )
      .get<{ count: number }>();
    const queueRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM turns WHERE state = 'queued'")
      .get<{ count: number }>();

    return {
      active_threads: Number(activeRow?.count ?? 0),
      queued_threads: Number(queueRow?.count ?? 0)
    };
  }

  getThreadDetail(threadId: string): ThreadDetail | undefined {
    const thread = this.getThread(threadId);

    if (!thread) {
      return undefined;
    }

    const project = this.getProject(thread.project_id);

    if (!project) {
      return undefined;
    }

    return {
      project,
      thread,
      turns: this.listTurns(threadId),
      approvals: this.listApprovals(threadId),
      patches: this.listPatches(threadId),
      native_requests: this.listNativeRequests(threadId)
    };
  }
}
