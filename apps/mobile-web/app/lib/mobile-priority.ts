import type { CodexQueueEntry, CodexThread } from "@codex-remote/protocol";

function statePriority(state: string) {
  switch (state) {
    case "system_error":
      return 6;
    case "failed":
      return 5;
    case "waiting_input":
      return 5;
    case "waiting_approval":
      return 4;
    case "needs_review":
      return 3;
    case "running":
      return 2;
    case "interrupted":
      return 1;
    default:
      return 0;
  }
}

export function getMobileThreadPriority(thread: CodexThread) {
  return (
    statePriority(thread.state) +
    (thread.pending_native_requests && thread.pending_native_requests > 0 ? 50 : 0) +
    (thread.pending_approvals > 0 ? 40 : 0) +
    (thread.pending_patches > 0 ? 30 : 0)
  );
}

export function compareThreadsForMobile(left: CodexThread, right: CodexThread) {
  const priorityDelta = getMobileThreadPriority(right) - getMobileThreadPriority(left);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return right.updated_at.localeCompare(left.updated_at);
}

export function getMobileQueuePriority(entry: CodexQueueEntry) {
  switch (entry.kind) {
    case "input":
      return 5;
    case "approval":
      return 4;
    case "patch":
      return 3;
    case "failed":
      return 2;
    case "running":
      return 1;
    default:
      return 0;
  }
}

export function compareQueueEntriesForMobile(left: CodexQueueEntry, right: CodexQueueEntry) {
  const priorityDelta = getMobileQueuePriority(right) - getMobileQueuePriority(left);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return right.timestamp.localeCompare(left.timestamp);
}
