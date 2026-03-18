import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  type CodexCapabilities,
  type CodexLiveState,
  type CodexMessage,
  type CodexMessageDetail,
  type CodexOverview,
  type CodexProjectSummary,
  type CodexQueueEntry,
  type CodexSyncState,
  type CodexThread,
  type CodexTranscriptPage,
  type CodexTimeline,
  type CodexTimelineItem,
  type GatewayEvent
} from "@codex-remote/protocol";

import type { GatewayStore } from "../lib/store";
import { slugify } from "../lib/path";
import { openReadOnlySqliteDatabase } from "../lib/sqlite";
import { nowIso } from "../lib/time";
import { createUlid } from "../lib/ulid";
import { CodexSettingsBridge } from "./codex-settings-bridge";
import { SessionHub } from "./session-hub";

interface NativeThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  source: string;
  cwd: string;
  title: string;
  archived: number;
}

interface CodexStateBridgeOptions {
  adapterKind: "mock" | "codex-app-server";
  codexHome?: string;
  pollIntervalMs?: number;
  hasApprovalBinding?: (approvalId: string) => boolean;
  sessionHub: SessionHub;
  settingsBridge?: CodexSettingsBridge;
  isTurnActive?: (turnId: string) => boolean;
  store: GatewayStore;
}

interface NativeTimelineSnapshot {
  items: CodexTimelineItem[];
  observedUserMessages: string[];
  lastObservedUserMessageAt?: string;
}

interface ObservedAssistantMessage {
  phase: string;
  text: string;
  timestampMs: number;
}

interface ThreadSyncSnapshot {
  syncState: CodexSyncState;
  lastNativeObservedAt?: string;
  missingTurnIds: string[];
}

interface NativeThreadVersion {
  rolloutMtimeMs: number;
  updatedAt: number;
}

interface SyncStoreOptions {
  force?: boolean;
  reason?: string;
  threadIds?: Iterable<string>;
}

interface TranscriptCursor {
  beforeTimestamp: string;
  beforeMessageId: string;
}

const DEFAULT_SYNC_TIMEOUT_MS = 20_000;

function toIsoTimestamp(raw: number | string) {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(value)) {
    return new Date().toISOString();
  }

  const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value;
  return new Date(milliseconds).toISOString();
}

function projectIdFromRepoRoot(repoRoot: string) {
  return `project_${slugify(repoRoot)}`;
}

function projectLabelFromRepoRoot(repoRoot: string) {
  const normalized = repoRoot.split(/[\\/]/).filter(Boolean);
  return normalized.at(-1) ?? repoRoot;
}

function truncate(value: string, max = 220) {
  const normalized = value.trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function normalizePrompt(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeAssistantText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeAssistantPhase(value: string | undefined) {
  return (value ?? "response").trim().toLowerCase();
}

function extractMessageText(value: unknown): string {
  const parts: string[] = [];

  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      if (normalized) {
        parts.push(normalized);
      }
      return;
    }

    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry);
      }
      return;
    }

    if (!candidate || typeof candidate !== "object") {
      return;
    }

    const record = candidate as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (
      typeof record.text === "string" &&
      record.text.trim() &&
      (!record.content || type === "output_text" || type === "input_text" || type === "text")
    ) {
      parts.push(record.text.trim());
    }
    if (typeof record.output_text === "string" && record.output_text.trim()) {
      parts.push(record.output_text.trim());
    }
    if (typeof record.value === "string" && record.value.trim() && type.includes("text")) {
      parts.push(record.value.trim());
    }
    if (record.content) {
      visit(record.content);
    }
    if (record.parts) {
      visit(record.parts);
    }
  };

  visit(value);
  return parts.join("\n\n").trim();
}

function extractAssistantResponseMessage(
  payload: Record<string, unknown>
): { phase?: string; text: string } | null {
  if (payload.type !== "message" || payload.role !== "assistant") {
    return null;
  }

  const text = extractMessageText(payload.content ?? payload.parts ?? payload.output ?? payload.text);
  if (!text) {
    return null;
  }

  return {
    phase:
      typeof payload.phase === "string"
        ? payload.phase
        : typeof payload.message_phase === "string"
          ? payload.message_phase
          : undefined,
    text
  };
}

function shouldSkipAssistantMessage(
  observed: ObservedAssistantMessage[],
  input: {
    phase?: string;
    text: string;
    timestamp: string;
  }
) {
  const normalizedText = normalizeAssistantText(input.text);
  const normalizedPhase = normalizeAssistantPhase(input.phase);
  const timestampMs = toTimestampMs(input.timestamp);

  return observed.some((candidate) => {
    if (candidate.phase !== normalizedPhase || candidate.text !== normalizedText) {
      return false;
    }

    if (candidate.timestampMs === 0 || timestampMs === 0) {
      return true;
    }

    return Math.abs(candidate.timestampMs - timestampMs) <= 10_000;
  });
}

function rememberAssistantMessage(
  observed: ObservedAssistantMessage[],
  input: {
    phase?: string;
    text: string;
    timestamp: string;
  }
) {
  observed.push({
    phase: normalizeAssistantPhase(input.phase),
    text: normalizeAssistantText(input.text),
    timestampMs: toTimestampMs(input.timestamp)
  });
}

function toTimestampMs(value?: string) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function humanizeToolName(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function inferAssistantDetailKind(item: CodexTimelineItem): CodexMessageDetail["kind"] {
  const haystack = `${item.title ?? ""} ${item.body ?? ""} ${item.phase ?? ""}`.toLowerCase();
  if (item.kind === "tool_call") {
    return "tool_call";
  }
  if (item.kind === "tool_result") {
    return "tool_result";
  }
  if (haystack.includes("test")) {
    return "testing";
  }
  if (
    haystack.includes("edit") ||
    haystack.includes("patch") ||
    haystack.includes("write") ||
    haystack.includes("file")
  ) {
    return "editing";
  }
  if (item.kind === "status") {
    return "status";
  }
  return "thinking";
}

function shouldDisplayTranscriptAction(item: CodexTimelineItem) {
  if (item.kind === "approval") {
    return item.status === "requested";
  }

  if (item.kind === "patch") {
    return item.status !== "applied" && item.status !== "discarded";
  }

  return item.action_required;
}

function encodeTranscriptCursor(cursor: TranscriptCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeTranscriptCursor(raw: string | undefined): TranscriptCursor | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<TranscriptCursor>;
    if (
      typeof parsed.beforeTimestamp === "string" &&
      parsed.beforeTimestamp.length > 0 &&
      typeof parsed.beforeMessageId === "string" &&
      parsed.beforeMessageId.length > 0
    ) {
      return {
        beforeTimestamp: parsed.beforeTimestamp,
        beforeMessageId: parsed.beforeMessageId
      };
    }
  } catch {
    return null;
  }

  return null;
}

function compareChronological(
  left: { timestamp: string; message_id?: string; item_id?: string },
  right: { timestamp: string; message_id?: string; item_id?: string }
) {
  const timestampComparison = left.timestamp.localeCompare(right.timestamp);
  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  const leftId = left.message_id ?? left.item_id ?? "";
  const rightId = right.message_id ?? right.item_id ?? "";
  return leftId.localeCompare(rightId);
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class CodexStateBridge {
  readonly codexHome: string;

  private nativeThreads = new Map<string, NativeThreadRow>();
  private nativeThreadVersions = new Map<string, NativeThreadVersion>();
  private pollInterval: NodeJS.Timeout | null = null;
  private syncQueue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: CodexStateBridgeOptions) {
    this.codexHome =
      options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  }

  async start() {
    this.stopped = false;
    await this.syncStore();

    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => {
        void this.syncStore();
      }, this.options.pollIntervalMs ?? 750);
    }
  }

  async stop() {
    this.stopped = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    await this.syncQueue;
  }

  async syncStore(input: SyncStoreOptions = {}) {
    if (this.stopped) {
      return;
    }

    await this.enqueueSync(async () => {
      if (this.stopped) {
        return;
      }
      await this.performSyncStore(input);
    });
  }

  async syncThreadNow(threadId: string) {
    const resolvedThreadId = this.resolveNativeThreadId(threadId);
    await this.syncStore({
      reason: "thread_targeted_resync",
      threadIds: [resolvedThreadId]
    });
  }

  private enqueueSync(task: () => Promise<void>) {
    if (this.stopped) {
      return Promise.resolve();
    }

    const guardedTask = async () => {
      if (this.stopped) {
        return;
      }
      await task();
    };

    const run = this.syncQueue.then(guardedTask, guardedTask);
    this.syncQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async performSyncStore(input: SyncStoreOptions) {
    if (this.stopped) {
      return;
    }

    const threads = await this.loadNativeThreads();
    this.nativeThreads = new Map(threads.map((thread) => [thread.id, thread]));
    const activeThreadIds = new Set(threads.map((thread) => thread.id));
    const targetThreadIds = input.threadIds
      ? new Set([...input.threadIds].map((threadId) => this.resolveNativeThreadId(threadId)))
      : null;

    for (const thread of threads) {
      if (targetThreadIds && !targetThreadIds.has(thread.id)) {
        continue;
      }

      const existing =
        this.options.store.getThread(thread.id) ??
        this.options.store.findThreadByAdapterRef(thread.id);
      const publicThreadId = existing?.thread_id ?? thread.id;
      const projectId = existing?.project_id ?? projectIdFromRepoRoot(thread.cwd);
      this.options.store.saveProject({
        project_id: projectId,
        repo_root: thread.cwd,
        created_at: toIsoTimestamp(thread.created_at),
        updated_at: toIsoTimestamp(thread.updated_at)
      });

      const pendingApprovals = this.listNativeApprovals(publicThreadId).filter(
        (approval) => approval.status === "requested"
      );
      const pendingPatches = this.options.store
        .listPatches(publicThreadId)
        .filter((patch) => patch.status !== "applied" && patch.status !== "discarded");
      const hasRuntimeActiveTurn = Boolean(
        existing?.active_turn_id &&
          this.options.isTurnActive?.(existing.active_turn_id)
      );

      const nextState =
        thread.archived
          ? "archived"
          : hasRuntimeActiveTurn
            ? pendingApprovals.length > 0
              ? "waiting_approval"
              : "running"
            : pendingApprovals.length > 0
              ? "waiting_approval"
              : pendingPatches.length > 0 || existing?.state === "completed"
                ? "completed"
                : "ready";

      const mirroredThread = this.options.store.saveThread({
        project_id: projectId,
        thread_id: publicThreadId,
        state: nextState,
        active_turn_id: hasRuntimeActiveTurn ? existing?.active_turn_id ?? null : null,
        pending_turn_ids: existing?.pending_turn_ids ?? [],
        pending_approval_ids:
          pendingApprovals.length > 0
            ? pendingApprovals.map((approval) => approval.approval_id)
            : [],
        worktree_path: existing?.worktree_path,
        adapter_kind: "codex-app-server",
        adapter_thread_ref: thread.id,
        native_title: thread.title || thread.id,
        native_archived: Boolean(thread.archived),
        native_status_type: thread.archived ? "archived" : "idle",
        native_active_flags: [],
        native_turn_ref: existing?.native_turn_ref,
        last_stream_seq: existing?.last_stream_seq ?? 0,
        created_at: toIsoTimestamp(thread.created_at),
        updated_at: toIsoTimestamp(thread.updated_at)
      });

      const nextVersion = await this.readNativeThreadVersion(thread);
      const previousVersion = this.nativeThreadVersions.get(thread.id);
      this.nativeThreadVersions.set(thread.id, nextVersion);
      const hasVersionChanged = previousVersion
        ? previousVersion.updatedAt !== nextVersion.updatedAt ||
          previousVersion.rolloutMtimeMs !== nextVersion.rolloutMtimeMs
        : false;
      if (
        hasVersionChanged ||
        (input.force && (!targetThreadIds || targetThreadIds.has(thread.id)))
      ) {
        this.publishNativeUpdate(mirroredThread, {
          updated_at: toIsoTimestamp(thread.updated_at),
          reason: input.reason ?? (hasVersionChanged ? "native_state_changed" : "native_resynced")
        });
      }
    }

    for (const threadId of [...this.nativeThreadVersions.keys()]) {
      if (!activeThreadIds.has(threadId)) {
        this.nativeThreadVersions.delete(threadId);
      }
    }

    for (const thread of this.options.store.listThreads()) {
      if (
        thread.adapter_kind !== "codex-app-server" ||
        !thread.adapter_thread_ref ||
        activeThreadIds.has(thread.adapter_thread_ref)
      ) {
        continue;
      }

      this.options.store.deleteThread(thread.thread_id);
    }
  }

  async getOverview(): Promise<CodexOverview> {
    await this.syncStore();

    const threads = (await Promise.all(
      [...this.nativeThreads.values()].map((thread) => this.buildCodexThread(thread))
    ))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .filter((thread) => !thread.archived);

    const projects = new Map<string, CodexProjectSummary>();
    for (const thread of threads) {
      if (!projects.has(thread.project_id)) {
        projects.set(thread.project_id, {
          project_id: thread.project_id,
          label: thread.project_label,
          repo_root: thread.repo_root
        });
      }
    }

    return {
      projects: [...projects.values()].sort((left, right) =>
        left.label.localeCompare(right.label)
      ),
      threads,
      queue: this.buildQueue(threads),
      capabilities: await this.getCapabilities()
    };
  }

  async getThread(threadId: string): Promise<CodexThread | null> {
    await this.syncStore();
    const thread = this.getNativeThreadByPublicId(threadId);
    return thread ? this.buildCodexThread(thread) : null;
  }

  async getTimeline(threadId: string): Promise<CodexTimeline | null> {
    await this.syncStore();
    const nativeThread = this.getNativeThreadByPublicId(threadId);
    if (!nativeThread) {
      return null;
    }

    const timelineSnapshot = await this.loadTimelineItems(nativeThread);
    const thread = await this.buildCodexThread(nativeThread, timelineSnapshot.syncSnapshot);
    const items = timelineSnapshot.items;
    const approvals = this.listNativeApprovals(thread.thread_id);
    const patches = this.options.store.listPatches(thread.thread_id);
    const nativeRequests = this.options.store.listNativeRequests(thread.thread_id);

    return {
      thread,
      items,
      approvals,
      patches,
      native_requests: nativeRequests
    };
  }

  async getTranscriptPage(input: {
    threadId: string;
    cursor?: string;
    limit?: number;
  }): Promise<CodexTranscriptPage | null> {
    const timeline = await this.getTimeline(input.threadId);
    if (!timeline) {
      return null;
    }

    const messages = this.buildTranscriptMessages(timeline).filter(
      (message) => message.origin === "native_confirmed"
    );
    const liveState = this.resolveTranscriptLiveState(timeline.thread.thread_id, messages);
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const cursor = decodeTranscriptCursor(input.cursor);

    let endIndex = messages.length;
    if (cursor) {
      const cursorIndex = messages.findIndex(
        (message) =>
          message.message_id === cursor.beforeMessageId &&
          message.timestamp === cursor.beforeTimestamp
      );
      if (cursorIndex !== -1) {
        endIndex = cursorIndex;
      }
    }

    const startIndex = Math.max(0, endIndex - limit);
    const pageItems = messages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;
    const nextCursor = hasMore
      ? encodeTranscriptCursor({
          beforeTimestamp: messages[startIndex].timestamp,
          beforeMessageId: messages[startIndex].message_id
        })
      : undefined;

    return {
      thread: timeline.thread,
      items: pageItems,
      approvals: timeline.approvals.filter((approval) => approval.source === "native"),
      patches: timeline.patches,
      native_requests: timeline.native_requests,
      live_state: liveState,
      next_cursor: nextCursor,
      has_more: hasMore
    };
  }

  async getQueue(): Promise<CodexQueueEntry[]> {
    const overview = await this.getOverview();
    return overview.queue;
  }

  async getCapabilities(): Promise<CodexCapabilities> {
    const sharedStateAvailable =
      (await pathExists(path.join(this.codexHome, "state_5.sqlite"))) &&
      (await pathExists(path.join(this.codexHome, "session_index.jsonl")));

    const canControlSharedThreads =
      sharedStateAvailable && this.options.adapterKind === "codex-app-server";
    const settingsCapabilities = this.options.settingsBridge
      ? await this.options.settingsBridge.getCapabilities()
      : {
          settings_read: false,
          settings_write: false,
          shared_model_config: false
        };

    return {
      adapter_kind:
        this.options.adapterKind === "codex-app-server" ? "codex-app-server" : undefined,
      collaboration_mode: "default",
      codex_home: this.codexHome,
      shared_state_available: sharedStateAvailable,
      shared_thread_create: canControlSharedThreads,
      supports_images: false,
      run_start: canControlSharedThreads,
      live_follow_up: false,
      image_inputs: false,
      interrupt: canControlSharedThreads,
      approvals: true,
      patch_decisions: true,
      thread_rename: canControlSharedThreads,
      thread_archive: canControlSharedThreads,
      thread_compact: canControlSharedThreads,
      thread_fork: canControlSharedThreads,
      thread_rollback: canControlSharedThreads,
      review_start: canControlSharedThreads,
      skills_input: false,
      diagnostics_read: false,
      settings_read: settingsCapabilities.settings_read,
      settings_write: settingsCapabilities.settings_write,
      shared_model_config: settingsCapabilities.shared_model_config,
      shared_history: sharedStateAvailable,
      shared_threads: sharedStateAvailable,
      reason: !sharedStateAvailable
        ? "Shared Codex state is unavailable on this host."
        : this.options.adapterKind !== "codex-app-server"
          ? "Set CODEX_REMOTE_ADAPTER=codex-app-server to control shared Codex threads."
          : "Live follow-up unavailable on this Codex build."
    };
  }

  private async loadNativeThreads(): Promise<NativeThreadRow[]> {
    const databasePath = path.join(this.codexHome, "state_5.sqlite");
    if (!(await pathExists(databasePath))) {
      return [];
    }

    const database = await openReadOnlySqliteDatabase(databasePath);
    try {
      return database
        .prepare(
          `
            SELECT id, rollout_path, created_at, updated_at, source, cwd, title, archived
            FROM threads
            ORDER BY updated_at DESC, id DESC
          `
        )
        .all<NativeThreadRow>();
    } finally {
      database.close();
    }
  }

  private async buildCodexThread(
    nativeThread: NativeThreadRow,
    syncSnapshot?: ThreadSyncSnapshot
  ): Promise<CodexThread> {
    const mirrored = this.getMirroredThread(nativeThread.id);
    const publicThreadId = mirrored?.thread_id ?? nativeThread.id;
    const pendingApprovals = this.listNativeApprovals(publicThreadId).filter(
      (approval) => approval.status === "requested"
    ).length;
    const pendingNativeRequests = this.options.store
      .listNativeRequests(publicThreadId)
      .filter((request) => request.status === "requested").length;
    const pendingPatches = this.options.store
      .listPatches(publicThreadId)
      .filter((patch) => patch.status !== "applied" && patch.status !== "discarded").length;
    const resolvedSyncSnapshot =
      syncSnapshot ?? (await this.computeThreadSyncSnapshot(nativeThread));

    let state: CodexThread["state"] = nativeThread.archived ? "archived" : "ready";
    if (nativeThread.archived || mirrored?.state === "archived" || mirrored?.native_archived) {
      state = "archived";
    } else if (pendingNativeRequests > 0 || mirrored?.state === "waiting_input") {
      state = "waiting_input";
    } else if (pendingApprovals > 0 || mirrored?.state === "waiting_approval") {
      state = "waiting_approval";
    } else if (pendingPatches > 0) {
      state = "needs_review";
    } else if (mirrored?.state === "running" || mirrored?.active_turn_id) {
      state = "running";
    } else if (mirrored?.state === "completed") {
      state = "completed";
    } else if (mirrored?.state === "failed") {
      state = "failed";
    } else if (mirrored?.state === "interrupted") {
      state = "interrupted";
    }

    return {
      thread_id: publicThreadId,
      project_id: mirrored?.project_id ?? projectIdFromRepoRoot(nativeThread.cwd),
      title: mirrored?.native_title ?? (nativeThread.title || publicThreadId),
      project_label: projectLabelFromRepoRoot(nativeThread.cwd),
      repo_root: nativeThread.cwd,
      source: nativeThread.source,
      state,
      archived: mirrored?.native_archived ?? Boolean(nativeThread.archived),
      has_active_run:
        Boolean(mirrored?.active_turn_id) &&
        (state === "running" || state === "waiting_approval"),
      pending_approvals: pendingApprovals,
      pending_patches: pendingPatches,
      pending_native_requests: pendingNativeRequests,
      worktree_path: mirrored?.worktree_path,
      active_turn_id: mirrored?.active_turn_id ?? null,
      last_stream_seq: mirrored?.last_stream_seq ?? 0,
      sync_state: resolvedSyncSnapshot.syncState,
      last_native_observed_at: resolvedSyncSnapshot.lastNativeObservedAt,
      adapter_thread_ref: nativeThread.id,
      native_status_type: mirrored?.native_status_type ?? (nativeThread.archived ? "archived" : "idle"),
      native_active_flags: mirrored?.native_active_flags ?? [],
      created_at: toIsoTimestamp(nativeThread.created_at),
      updated_at: toIsoTimestamp(nativeThread.updated_at)
    };
  }

  private buildQueue(threads: CodexThread[]): CodexQueueEntry[] {
    const threadsById = new Map(threads.map((thread) => [thread.thread_id, thread]));
    const entries: CodexQueueEntry[] = [];

    for (const thread of threads) {
      if (thread.state === "running" && thread.active_turn_id) {
        entries.push({
          entry_id: `running-${thread.thread_id}`,
          kind: "running",
          thread_id: thread.thread_id,
          title: thread.title,
          summary: "Run in progress",
          timestamp: thread.updated_at,
          status: "Running",
          turn_id: thread.active_turn_id,
          action_required: false
        });
      }

      if (thread.state === "failed" || thread.state === "interrupted") {
        entries.push({
          entry_id: `failed-${thread.thread_id}`,
          kind: "failed",
          thread_id: thread.thread_id,
          title: thread.title,
          summary: "Run needs follow-up",
          timestamp: thread.updated_at,
          status: thread.state === "failed" ? "Failed" : "Interrupted",
          action_required: true
        });
      }
    }

    for (const thread of threads) {
      for (const approval of this.listNativeApprovals(thread.thread_id)) {
        if (approval.status !== "requested") {
          continue;
        }
        entries.push({
          entry_id: `approval-${approval.approval_id}`,
          kind: "approval",
          thread_id: thread.thread_id,
          title: thread.title,
          summary: approval.reason,
          timestamp: approval.requested_at,
          status: "Waiting for approval",
          turn_id: approval.turn_id,
          approval_id: approval.approval_id,
          action_required: true
        });
      }

      for (const patch of this.options.store.listPatches(thread.thread_id)) {
        if (patch.status === "applied" || patch.status === "discarded") {
          continue;
        }
        entries.push({
          entry_id: `patch-${patch.patch_id}`,
          kind: "patch",
          thread_id: thread.thread_id,
          title: thread.title,
          summary: patch.summary,
          timestamp: patch.updated_at,
          status: "Needs review",
          turn_id: patch.turn_id,
          patch_id: patch.patch_id,
          action_required: true
        });
      }
    }

    return entries
      .filter((entry) => threadsById.has(entry.thread_id))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }

  private buildTranscriptMessages(timeline: CodexTimeline): CodexMessage[] {
    const sourceItems = [...timeline.items].sort(compareChronological);
    const messages: CodexMessage[] = [];
    let assistantDraft: CodexMessage | null = null;

    const flushAssistantDraft = () => {
      if (!assistantDraft) {
        return;
      }

      const normalizedBody = assistantDraft.body?.trim();
      if (normalizedBody) {
        assistantDraft.body = normalizedBody;
        messages.push(assistantDraft);
      }
      assistantDraft = null;
    };

    const ensureAssistantDraft = (item: CodexTimelineItem) => {
      if (!assistantDraft) {
        assistantDraft = {
          message_id: `assistant-${item.turn_id ?? item.item_id}`,
          thread_id: item.thread_id,
          timestamp: item.timestamp,
          role: "assistant",
          body: undefined,
          turn_id: item.turn_id,
          origin: item.origin,
          status: item.status,
          action_required: false,
          details: []
        };
      }

      if (item.origin === "gateway_fallback") {
        assistantDraft.origin = "gateway_fallback";
      }
      if (compareChronological(item, assistantDraft) < 0) {
        assistantDraft.timestamp = item.timestamp;
      }
      if (item.status) {
        assistantDraft.status = item.status;
      }

      return assistantDraft;
    };

    for (const item of sourceItems) {
      if (item.kind === "user_message") {
        flushAssistantDraft();
        messages.push({
          message_id: `message-${item.item_id}`,
          thread_id: item.thread_id,
          timestamp: item.timestamp,
          role: "user",
          body: item.body,
          title: item.title,
          turn_id: item.turn_id,
          origin: item.origin,
          action_required: false,
          details: []
        });
        continue;
      }

      if (item.kind === "approval" || item.kind === "patch" || item.action_required) {
        if (!shouldDisplayTranscriptAction(item)) {
          continue;
        }

        flushAssistantDraft();
        messages.push({
          message_id: `message-${item.item_id}`,
          thread_id: item.thread_id,
          timestamp: item.timestamp,
          role: "system_action",
          body: item.body,
          title: item.title,
          turn_id: item.turn_id,
          origin: item.origin,
          status: item.status,
          approval_id: item.approval_id,
          patch_id: item.patch_id,
          action_required: item.action_required,
          details: []
        });
        continue;
      }

      const assistantMessage = ensureAssistantDraft(item);
      if (item.kind === "assistant_message" && item.phase !== "commentary") {
        assistantMessage.body = assistantMessage.body
          ? `${assistantMessage.body}\n\n${item.body ?? item.title}`
          : item.body ?? item.title;
        continue;
      }

      assistantMessage.details.push({
        detail_id: `detail-${item.item_id}`,
        timestamp: item.timestamp,
        kind: inferAssistantDetailKind(item),
        title: item.title,
        body: item.body,
        status: item.status,
        mono: item.mono
      });
    }

    flushAssistantDraft();
    return messages.sort(compareChronological);
  }

  private shouldClearMaterializedLiveState(
    threadId: string,
    liveState: CodexLiveState,
    messages: CodexMessage[]
  ) {
    const turn = liveState.turn_id
      ? this.options.store.getTurn(liveState.turn_id)
      : undefined;
    const hasTerminalTurnState =
      turn?.state === "completed" ||
      turn?.state === "failed" ||
      turn?.state === "interrupted" ||
      liveState.status === "completed" ||
      liveState.status === "failed" ||
      liveState.status === "interrupted";

    if (!liveState.awaiting_native_commit && !hasTerminalTurnState) {
      return false;
    }

    const cutoffMs = turn?.created_at
      ? toTimestampMs(turn.created_at)
      : toTimestampMs(liveState.updated_at);

    return messages.some(
      (message) =>
        message.thread_id === threadId &&
        message.origin === "native_confirmed" &&
        message.role === "assistant" &&
        Boolean(message.body?.trim()) &&
        toTimestampMs(message.timestamp) >= cutoffMs
    );
  }

  private resolveTranscriptLiveState(
    threadId: string,
    messages: CodexMessage[]
  ): CodexLiveState | undefined {
    const liveState = this.options.store.getLiveState(threadId);
    if (!liveState) {
      return undefined;
    }

    if (this.shouldClearMaterializedLiveState(threadId, liveState, messages)) {
      this.options.store.clearLiveState(threadId);
      return undefined;
    }

    return liveState;
  }

  private async loadTimelineItems(
    nativeThread: NativeThreadRow
  ): Promise<NativeTimelineSnapshot & { syncSnapshot: ThreadSyncSnapshot }> {
    const nativeSnapshot = await this.loadNativeTimelineSnapshot(nativeThread);
    const syncSnapshot = await this.computeThreadSyncSnapshot(nativeThread, nativeSnapshot);
    const items = [...nativeSnapshot.items];
    const publicThreadId = this.getPublicThreadId(nativeThread.id);

    for (const approval of this.listNativeApprovals(publicThreadId)) {
      items.push({
        item_id: `approval-${approval.approval_id}`,
        thread_id: publicThreadId,
        timestamp: approval.resolved_at ?? approval.requested_at,
        origin: "native_confirmed",
        kind: "approval",
        title:
          approval.status === "requested"
            ? "Waiting for approval"
            : `Approval ${approval.status}`,
        body: approval.reason,
        status: approval.status,
        turn_id: approval.turn_id,
        approval_id: approval.approval_id,
        action_required: approval.status === "requested",
        mono: false
      });
    }

    for (const patch of this.options.store.listPatches(publicThreadId)) {
      items.push({
        item_id: `patch-${patch.patch_id}`,
        thread_id: publicThreadId,
        timestamp: patch.updated_at,
        origin: "native_confirmed",
        kind: "patch",
        title: patch.summary,
        body: patch.files.map((file) => file.path).join(", "),
        status: patch.status,
        turn_id: patch.turn_id,
        patch_id: patch.patch_id,
        action_required: patch.status !== "applied" && patch.status !== "discarded",
        mono: false
      });
    }

    return {
      items: items.sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
      observedUserMessages: nativeSnapshot.observedUserMessages,
      syncSnapshot
    };
  }

  private async loadNativeTimelineSnapshot(
    nativeThread: NativeThreadRow
  ): Promise<NativeTimelineSnapshot> {
    const items: CodexTimelineItem[] = [];
    const observedUserMessages: string[] = [];
    const observedAssistantMessages: ObservedAssistantMessage[] = [];
    let lastObservedUserMessageAt: string | undefined;
    const toolCallNames = new Map<string, string>();
    const fallbackTimestamp = toIsoTimestamp(nativeThread.updated_at);

    if (await pathExists(nativeThread.rollout_path)) {
      const content = await fs.readFile(nativeThread.rollout_path, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) {
          continue;
        }

        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        const timestamp =
          typeof record.timestamp === "string" ? record.timestamp : fallbackTimestamp;

        if (record.type === "event_msg") {
          const payload = record.payload as Record<string, unknown> | undefined;
          if (!payload) {
            continue;
          }

          if (payload.type === "user_message") {
            const message = typeof payload.message === "string" ? payload.message : "";
            const normalizedMessage = normalizePrompt(message);
            if (normalizedMessage) {
              observedUserMessages.push(normalizedMessage);
              lastObservedUserMessageAt = timestamp;
              items.push({
                item_id: `user-${items.length}-${timestamp}`,
                thread_id: nativeThread.id,
                timestamp,
                origin: "native_confirmed",
                kind: "user_message",
                title: "You",
                body: normalizedMessage,
                action_required: false,
                mono: false
              });
            }
            continue;
          }

          if (payload.type === "agent_message") {
            const message = typeof payload.message === "string" ? payload.message : "";
            if (message.trim()) {
              const phase =
                typeof payload.phase === "string" ? payload.phase : undefined;
              if (
                shouldSkipAssistantMessage(observedAssistantMessages, {
                  phase,
                  text: message,
                  timestamp
                })
              ) {
                continue;
              }

              items.push({
                item_id: `assistant-${items.length}-${timestamp}`,
                thread_id: nativeThread.id,
                timestamp,
                origin: "native_confirmed",
                kind: "assistant_message",
                title: phase === "commentary" ? "Codex progress" : "Codex",
                body: message.trim(),
                phase,
                action_required: false,
                mono: false
              });
              rememberAssistantMessage(observedAssistantMessages, {
                phase,
                text: message,
                timestamp
              });
            }
          }

          continue;
        }

        if (record.type !== "response_item") {
          continue;
        }

        const payload = record.payload as Record<string, unknown> | undefined;
        if (!payload) {
          continue;
        }

        const assistantResponseMessage = extractAssistantResponseMessage(payload);
        if (assistantResponseMessage) {
          if (
            shouldSkipAssistantMessage(observedAssistantMessages, {
              ...assistantResponseMessage,
              timestamp
            })
          ) {
            continue;
          }

          items.push({
            item_id: `assistant-${items.length}-${timestamp}`,
            thread_id: nativeThread.id,
            timestamp,
            origin: "native_confirmed",
            kind: "assistant_message",
            title:
              assistantResponseMessage.phase === "commentary"
                ? "Codex progress"
                : "Codex",
            body: assistantResponseMessage.text,
            phase: assistantResponseMessage.phase,
            action_required: false,
            mono: false
          });
          rememberAssistantMessage(observedAssistantMessages, {
            ...assistantResponseMessage,
            timestamp
          });
          continue;
        }

        if (
          (payload.type === "function_call" || payload.type === "custom_tool_call") &&
          typeof payload.name === "string"
        ) {
          const callId =
            typeof payload.call_id === "string"
              ? payload.call_id
              : typeof payload.id === "string"
                ? payload.id
                : `${payload.name}-${items.length}`;
          toolCallNames.set(callId, payload.name);
          const rawInput =
            typeof payload.arguments === "string"
              ? payload.arguments
              : typeof payload.input === "string"
                ? payload.input
                : "";
          items.push({
            item_id: `tool-call-${callId}`,
            thread_id: nativeThread.id,
            timestamp,
            origin: "native_confirmed",
            kind: "tool_call",
            title: humanizeToolName(payload.name),
            body: rawInput ? truncate(rawInput) : undefined,
            action_required: false,
            mono: Boolean(rawInput)
          });
          continue;
        }

        if (
          (payload.type === "function_call_output" ||
            payload.type === "custom_tool_call_output") &&
          typeof payload.call_id === "string"
        ) {
          const toolName = toolCallNames.get(payload.call_id) ?? "Tool output";
          const output =
            typeof payload.output === "string"
              ? payload.output
              : typeof payload.result === "string"
                ? payload.result
                : "";
          items.push({
            item_id: `tool-output-${payload.call_id}`,
            thread_id: nativeThread.id,
            timestamp,
            origin: "native_confirmed",
            kind: "tool_result",
            title: `${humanizeToolName(toolName)} output`,
            body: output ? truncate(output, 500) : "Tool completed.",
            action_required: false,
            mono: true
          });
        }
      }
    }

    return {
      items,
      observedUserMessages,
      lastObservedUserMessageAt
    };
  }

  private async computeThreadSyncSnapshot(
    nativeThread: NativeThreadRow,
    nativeTimelineSnapshot?: NativeTimelineSnapshot
  ): Promise<ThreadSyncSnapshot> {
    const snapshot =
      nativeTimelineSnapshot ?? (await this.loadNativeTimelineSnapshot(nativeThread));
    const nativeMessageCounts = new Map<string, number>();
    const mirrored = this.getMirroredThread(nativeThread.id);
    const publicThreadId = mirrored?.thread_id ?? nativeThread.id;
    const hasRuntimeActiveTurn = Boolean(
      mirrored?.active_turn_id &&
        this.options.isTurnActive?.(mirrored.active_turn_id)
    );
    const hasPendingApprovals = this.listNativeApprovals(publicThreadId).some(
      (approval) => approval.status === "requested"
    );
    const hasPendingPatches = this.options.store
      .listPatches(publicThreadId)
      .some((patch) => patch.status !== "applied" && patch.status !== "discarded");

    for (const message of snapshot.observedUserMessages) {
      nativeMessageCounts.set(message, (nativeMessageCounts.get(message) ?? 0) + 1);
    }

    const turns = this.options.store.listTurns(publicThreadId);
    const missingTurnIds: string[] = [];
    let newestMissingTurnMs = 0;
    const nativeCutoffMs = toTimestampMs(snapshot.lastObservedUserMessageAt);

    for (const turn of turns) {
      const normalizedPrompt = normalizePrompt(turn.prompt);
      if (!normalizedPrompt) {
        continue;
      }

      const remaining = nativeMessageCounts.get(normalizedPrompt) ?? 0;
      if (remaining > 0) {
        nativeMessageCounts.set(normalizedPrompt, remaining - 1);
        continue;
      }

      const turnCreatedAtMs = toTimestampMs(turn.created_at);

      if (nativeCutoffMs > 0 && turnCreatedAtMs < nativeCutoffMs) {
        continue;
      }

      const shouldIgnoreStaleMissingTurn =
        !hasRuntimeActiveTurn &&
        !hasPendingApprovals &&
        !hasPendingPatches &&
        turnCreatedAtMs > 0 &&
        Date.now() - turnCreatedAtMs > DEFAULT_SYNC_TIMEOUT_MS;

      if (shouldIgnoreStaleMissingTurn) {
        continue;
      }

      missingTurnIds.push(turn.turn_id);
      newestMissingTurnMs = Math.max(newestMissingTurnMs, turnCreatedAtMs);
    }

    const syncState: CodexSyncState =
      missingTurnIds.length === 0
        ? "native_confirmed"
        : Date.now() - newestMissingTurnMs <= DEFAULT_SYNC_TIMEOUT_MS
          ? "sync_pending"
          : "sync_failed";

    return {
      syncState,
      lastNativeObservedAt: toIsoTimestamp(nativeThread.updated_at),
      missingTurnIds
    };
  }

  private listNativeApprovals(threadId: string) {
    return this.options.store
      .listApprovals(threadId)
      .filter((approval) => approval.source === "native")
      .map((approval) => ({
        ...approval,
        recoverable:
          approval.status === "requested"
            ? this.options.hasApprovalBinding?.(approval.approval_id) ?? approval.recoverable
            : approval.recoverable
      }));
  }

  private async readNativeThreadVersion(nativeThread: NativeThreadRow): Promise<NativeThreadVersion> {
    let rolloutMtimeMs = 0;
    try {
      const stats = await fs.stat(nativeThread.rollout_path);
      rolloutMtimeMs = stats.mtimeMs;
    } catch {
      rolloutMtimeMs = 0;
    }

    return {
      updatedAt: Number(nativeThread.updated_at),
      rolloutMtimeMs
    };
  }

  private resolveNativeThreadId(threadId: string) {
    const mirrored = this.options.store.getThread(threadId);
    return mirrored?.adapter_thread_ref ?? threadId;
  }

  private getNativeThreadByPublicId(threadId: string) {
    const nativeThreadId = this.resolveNativeThreadId(threadId);
    return this.nativeThreads.get(nativeThreadId);
  }

  private getMirroredThread(nativeThreadId: string) {
    return this.options.store.getThread(nativeThreadId) ??
      this.options.store.findThreadByAdapterRef(nativeThreadId);
  }

  private getPublicThreadId(nativeThreadId: string) {
    return this.getMirroredThread(nativeThreadId)?.thread_id ?? nativeThreadId;
  }

  private publishNativeUpdate(
    thread: CodexThread | { project_id: string; thread_id: string; updated_at: string; last_stream_seq?: number },
    payload: {
      updated_at: string;
      reason?: string;
    }
  ) {
    const event: GatewayEvent = {
      event_id: createUlid(),
      stream_seq: this.options.store.nextStreamSeq(thread.thread_id),
      schema_version: CURRENT_SCHEMA_VERSION,
      event_type: "thread.native_updated",
      project_id: thread.project_id,
      thread_id: thread.thread_id,
      timestamp: nowIso(),
      payload
    };

    this.options.store.appendEvent(event);
    this.options.store.saveThread({
      ...(this.options.store.getThread(thread.thread_id) ?? {
        project_id: thread.project_id,
        thread_id: thread.thread_id,
        state: "ready" as const,
        active_turn_id: null,
        pending_turn_ids: [],
        pending_approval_ids: [],
        last_stream_seq: 0,
        created_at: payload.updated_at,
        updated_at: payload.updated_at
      }),
      last_stream_seq: event.stream_seq,
      updated_at: event.timestamp ?? nowIso()
    });
    this.options.sessionHub.publish(event);
  }
}
