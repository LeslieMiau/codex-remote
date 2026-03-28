import type { CodexThread } from "@codex-remote/protocol";

import { localize, type Locale } from "./locale";

const RECOVERY_COPY_PATTERN = /^recovered\b/i;

type ThreadPreview = Pick<
  CodexThread,
  "degraded" | "project_label" | "source" | "title"
>;
type MobileThreadPreview = Pick<
  CodexThread,
  | "archived"
  | "degraded"
  | "pending_approvals"
  | "pending_native_requests"
  | "pending_patches"
  | "project_label"
  | "source"
  | "state"
  | "title"
>;

export function isRecoveryFallbackThread(thread: ThreadPreview | null | undefined) {
  if (!thread) {
    return false;
  }

  return (
    thread.degraded === true ||
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

export function hasBlockingThreadAttention(
  thread: MobileThreadPreview | null | undefined
) {
  if (!thread) {
    return false;
  }

  return (
    thread.pending_native_requests > 0 ||
    thread.pending_approvals > 0 ||
    thread.pending_patches > 0 ||
    thread.state === "failed" ||
    thread.state === "system_error"
  );
}

export function shouldHideThreadFromMobileList(
  thread: MobileThreadPreview | null | undefined
) {
  if (!thread) {
    return false;
  }

  if (thread.archived) {
    return true;
  }

  return isRecoveryFallbackThread(thread) && !hasBlockingThreadAttention(thread);
}
