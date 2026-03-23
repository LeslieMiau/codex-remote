import type { CodexThread } from "@codex-remote/protocol";

import { localize, type Locale } from "./locale";

const RECOVERY_COPY_PATTERN = /^recovered\b/i;

type ThreadPreview = Pick<CodexThread, "project_label" | "source" | "title">;

export function isRecoveryFallbackThread(thread: ThreadPreview | null | undefined) {
  if (!thread) {
    return false;
  }

  return (
    thread.source === "gateway_fallback" ||
    RECOVERY_COPY_PATTERN.test(thread.title ?? "") ||
    RECOVERY_COPY_PATTERN.test(thread.project_label ?? "")
  );
}

export function getDisplayThreadTitle(
  locale: Locale,
  thread: ThreadPreview | null | undefined
) {
  const title = thread?.title?.trim();
  if (!title || isRecoveryFallbackThread(thread)) {
    return localize(locale, { zh: "聊天", en: "Chat" });
  }
  return title;
}
