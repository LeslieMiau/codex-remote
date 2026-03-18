import type { CodexLiveState, CodexMessage } from "@codex-remote/protocol";

export type DisplayChatMessage = CodexMessage;

export function buildInlineLiveDraft(input: {
  liveState: CodexLiveState | null;
  locale: "zh" | "en";
  messages: CodexMessage[];
  threadId: string;
}): DisplayChatMessage | null {
  if (!input.liveState) {
    return null;
  }
  return {
    message_id: `live-draft:${input.threadId}`,
    thread_id: input.threadId,
    timestamp: input.liveState.updated_at,
    role: "assistant",
    body: input.liveState.detail ?? "",
    title: input.locale === "zh" ? "实时草稿" : "Live draft",
    details: input.liveState.details,
    status: input.liveState.status,
    awaiting_native_commit: input.liveState.awaiting_native_commit,
    is_live_draft: true,
    origin: "gateway_fallback",
    action_required: false
  };
}

export function renderLivePanelBody(
  locale: "zh" | "en",
  liveState: CodexLiveState,
  hasInlineDraft: boolean
) {
  if (liveState.awaiting_native_commit) {
    return locale === "zh"
      ? "正在等待原生 Codex 时间线确认这条消息。"
      : "Waiting for the native Codex timeline to confirm this message.";
  }
  if (liveState.detail?.trim()) {
    return liveState.detail;
  }
  return hasInlineDraft
    ? locale === "zh"
      ? "实时状态已同步到草稿消息中。"
      : "The live status is reflected in the draft message below."
    : locale === "zh"
      ? "Codex 正在继续处理这条线程。"
      : "Codex is still working on this thread.";
}
