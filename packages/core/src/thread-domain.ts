import type {
  CodexLiveState,
  CodexSyncState,
  CodexThread,
  ThreadSnapshot,
  TurnRecord
} from "@codex-remote/protocol";

export interface PendingThreadCounts {
  approvals: number;
  native_requests: number;
  patches: number;
}

export interface DeriveThreadSnapshotStateInput {
  threadState: ThreadSnapshot["state"];
  nativeArchived?: boolean;
  pending: PendingThreadCounts;
  activeTurnId?: string | null;
  activeTurnState?: TurnRecord["state"];
  latestTurnState?: TurnRecord["state"];
  hasActiveExecution?: boolean;
  forceState?: ThreadSnapshot["state"];
}

export interface BuildMirroredCodexThreadInput {
  thread: ThreadSnapshot;
  projectLabel: string;
  repoRoot: string;
  source: string;
  syncState: CodexSyncState;
  title: string;
  pending: PendingThreadCounts;
}

export function isTerminalTurnState(state: TurnRecord["state"]) {
  return state === "completed" || state === "failed" || state === "interrupted";
}

export function progressToTurnState(
  current: TurnRecord["state"],
  input: { resumed?: boolean }
): TurnRecord["state"] {
  if (input.resumed) {
    return "resumed";
  }
  if (current === "queued") {
    return "started";
  }
  if (
    current === "started" ||
    current === "resumed" ||
    current === "waiting_approval" ||
    current === "waiting_input"
  ) {
    return "streaming";
  }
  return current;
}

export function deriveThreadSnapshotState(
  input: DeriveThreadSnapshotStateInput
): ThreadSnapshot["state"] {
  if (input.threadState === "archived" || input.nativeArchived) {
    return "archived";
  }

  if (input.forceState) {
    return input.forceState;
  }

  if (input.pending.native_requests > 0) {
    return "waiting_input";
  }

  if (input.pending.approvals > 0) {
    return "waiting_approval";
  }

  if (input.pending.patches > 0) {
    return "needs_review";
  }

  if (input.activeTurnId && input.hasActiveExecution) {
    return "running";
  }

  if (input.activeTurnState === "interrupted") {
    return "interrupted";
  }

  if (input.activeTurnState === "failed") {
    return "failed";
  }

  if (input.activeTurnState === "completed") {
    return "completed";
  }

  if (input.latestTurnState === "failed") {
    return "failed";
  }

  if (input.latestTurnState === "interrupted") {
    return "interrupted";
  }

  if (input.latestTurnState === "completed") {
    return "completed";
  }

  return "ready";
}

export function deriveMirroredCodexThreadState(input: {
  threadState: ThreadSnapshot["state"];
  nativeArchived?: boolean;
  pending: PendingThreadCounts;
  activeTurnId?: string | null;
}): CodexThread["state"] {
  if (input.threadState === "archived" || input.nativeArchived) {
    return "archived";
  }

  if (input.threadState === "failed") {
    return "failed";
  }

  if (input.threadState === "interrupted") {
    return "interrupted";
  }

  if (input.pending.native_requests > 0 || input.threadState === "waiting_input") {
    return "waiting_input";
  }

  if (input.pending.approvals > 0 || input.threadState === "waiting_approval") {
    return "waiting_approval";
  }

  if (input.pending.patches > 0) {
    return "needs_review";
  }

  if (input.activeTurnId || input.threadState === "running") {
    return "running";
  }

  if (input.threadState === "completed") {
    return "completed";
  }

  return "ready";
}

export function deriveMirroredSyncState(input: {
  adapterThreadRef?: string;
  state: CodexThread["state"];
}): CodexSyncState {
  if (
    !input.adapterThreadRef ||
    input.state === "running" ||
    input.state === "waiting_approval" ||
    input.state === "waiting_input"
  ) {
    return "sync_pending";
  }

  return "sync_failed";
}

export function requiresMaterializedThreadControl(input: {
  adapter_thread_ref?: string;
  sync_state?: CodexThread["sync_state"];
}) {
  return !input.adapter_thread_ref || input.sync_state === "sync_pending";
}

export function isLiveStateAwaitingNativeCommit(
  liveState: Pick<CodexLiveState, "awaiting_native_commit"> | null | undefined
) {
  return Boolean(liveState?.awaiting_native_commit);
}

export function buildMirroredCodexThread(
  input: BuildMirroredCodexThreadInput
): CodexThread {
  const state = deriveMirroredCodexThreadState({
    threadState: input.thread.state,
    nativeArchived: input.thread.native_archived,
    pending: input.pending,
    activeTurnId: input.thread.active_turn_id
  });

  return {
    thread_id: input.thread.thread_id,
    project_id: input.thread.project_id,
    title: input.title,
    project_label: input.projectLabel,
    repo_root: input.repoRoot,
    source: input.source,
    state,
    archived: Boolean(input.thread.native_archived || input.thread.state === "archived"),
    has_active_run:
      Boolean(input.thread.active_turn_id) &&
      (state === "running" || state === "waiting_approval"),
    pending_approvals: input.pending.approvals,
    pending_patches: input.pending.patches,
    pending_native_requests: input.pending.native_requests,
    worktree_path: input.thread.worktree_path,
    active_turn_id: input.thread.active_turn_id,
    last_stream_seq: input.thread.last_stream_seq,
    sync_state: input.syncState,
    adapter_thread_ref: input.thread.adapter_thread_ref,
    native_status_type: input.thread.native_status_type,
    native_active_flags: input.thread.native_active_flags,
    native_token_usage: input.thread.native_token_usage,
    created_at: input.thread.created_at ?? input.thread.updated_at,
    updated_at: input.thread.updated_at
  };
}
