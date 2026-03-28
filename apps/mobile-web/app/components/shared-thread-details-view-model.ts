import type {
  CodexCapabilitiesResponse,
  CodexTranscriptPageResponse
} from "@codex-remote/protocol";

import { localize } from "../lib/locale";

interface SharedThreadDetailsViewModelInput {
  capabilities: CodexCapabilitiesResponse | null;
  hasSkillCapability: boolean;
  isLoading: boolean;
  isMutating: boolean;
  locale: "zh" | "en";
  remoteThreadActionsBlocked: boolean;
  selectedModelLabel: string | null;
  transcript: CodexTranscriptPageResponse | null;
}

export function buildSharedThreadDetailsViewModel(
  input: SharedThreadDetailsViewModelInput
) {
  const archiveDisabled =
    input.isMutating ||
    !input.capabilities?.thread_archive ||
    input.remoteThreadActionsBlocked;
  const compactDisabled =
    input.isMutating ||
    !input.capabilities?.thread_compact ||
    input.remoteThreadActionsBlocked;
  const forkDisabled =
    input.isMutating || !input.capabilities?.thread_fork || input.remoteThreadActionsBlocked;
  const reviewDisabled =
    input.isMutating || !input.capabilities?.review_start || input.remoteThreadActionsBlocked;
  const rollbackDisabled =
    input.isMutating ||
    !input.capabilities?.thread_rollback ||
    input.remoteThreadActionsBlocked;

  return {
    archiveDisabled,
    archiveLabel: input.transcript?.thread.archived
      ? localize(input.locale, { zh: "取消归档", en: "Unarchive" })
      : localize(input.locale, { zh: "归档", en: "Archive" }),
    compactDisabled,
    compactLabel: localize(input.locale, { zh: "压缩上下文", en: "Compact" }),
    forkDisabled,
    forkLabel: localize(input.locale, { zh: "分支一条聊天", en: "Fork chat" }),
    modelValue: input.selectedModelLabel ?? "-",
    quickActions: {
      pickSkillsDisabled: input.isMutating || !input.hasSkillCapability,
      refreshDisabled: input.isMutating || input.isLoading
    },
    reasoningValue: input.capabilities ? undefined : undefined,
    reviewDisabled,
    reviewLabel: localize(input.locale, { zh: "开始 review", en: "Start review" }),
    rollbackDisabled,
    rollbackInputDisabled: rollbackDisabled,
    rollbackLabel: localize(input.locale, { zh: "回滚聊天", en: "Rollback chat" }),
    syncBlockedNote: input.remoteThreadActionsBlocked
      ? localize(input.locale, {
          zh: "这条聊天还在等待进入原生 Codex 时间线，归档、分支、review 和回滚等操作会在同步完成后开放。",
          en: "This chat is still entering the native Codex timeline. Archive, fork, review, and rollback unlock after sync finishes."
        })
      : null,
    workspaceValue: input.transcript?.thread.repo_root ?? "-"
  };
}
