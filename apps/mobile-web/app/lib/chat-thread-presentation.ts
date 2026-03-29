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

type MobileThreadListLinesInput = Pick<CodexThread, "project_label" | "repo_root"> & {
  displayTitle: string;
  preview?: string | null;
  statusLabel?: string | null;
};

function getNormalizedCopyKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function appendUniqueCopy(
  target: string[],
  seen: Set<string>,
  value: string | null | undefined
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }

  const key = getNormalizedCopyKey(trimmed);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push(trimmed);
}

export function getRepoTail(repoRoot: string) {
  const parts = repoRoot.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? repoRoot;
}

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

export function buildMobileThreadListLines(input: MobileThreadListLinesInput) {
  const displayTitleKey = getNormalizedCopyKey(input.displayTitle);
  const metaTokens: string[] = [];
  const metaSeen = new Set<string>();
  appendUniqueCopy(metaTokens, metaSeen, input.project_label);
  appendUniqueCopy(metaTokens, metaSeen, getRepoTail(input.repo_root));

  const remainingMeta = metaTokens.filter(
    (value) => getNormalizedCopyKey(value) !== displayTitleKey
  );
  const secondaryTokens: string[] = [];
  const secondarySeen = new Set<string>();
  appendUniqueCopy(secondaryTokens, secondarySeen, input.preview);
  appendUniqueCopy(secondaryTokens, secondarySeen, input.statusLabel);

  if (!input.statusLabel && remainingMeta.length > 0) {
    appendUniqueCopy(secondaryTokens, secondarySeen, remainingMeta.shift() ?? null);
  }

  return {
    secondaryLine: secondaryTokens.join(" · ") || null,
    tertiaryLine: remainingMeta.join(" · ") || null
  };
}
