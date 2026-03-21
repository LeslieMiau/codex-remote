import type { CodexThread } from "@codex-remote/protocol";

function normalizeQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

function buildThreadSearchText(thread: CodexThread) {
  return [thread.title, thread.project_label, thread.repo_root]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLocaleLowerCase();
}

export function filterThreadsForQuery(threads: CodexThread[], query: string) {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return threads;
  }

  return threads.filter((thread) => buildThreadSearchText(thread).includes(normalized));
}
