"use client";

import * as React from "react";
import type { ApprovalRequest } from "@codex-remote/protocol";

import { renderLivePanelBody } from "../lib/live-draft";
import { type Locale, localize } from "../lib/locale";
import type { ChatTimelineItem, MessageGroup } from "../lib/chat-timeline";
import styles from "./shared-thread-workspace-refreshed.module.css";

interface ChatTimelineProps {
  emptyMessage?: string;
  hasMoreRemoteHistory: boolean;
  hiddenItemCount: number;
  isLoading: boolean;
  isLoadingOlder: boolean;
  locale: Locale;
  onDismissPendingSend(localId: string): void;
  onEditPendingSend(localId: string): void;
  onOpenPatchReview(patchId: string): void;
  onRetryPendingSend(localId: string): void;
  pendingApprovalsById: Map<string, ApprovalRequest>;
  timelineItems: ChatTimelineItem[];
}

function formatClockTime(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDayLabel(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    weekday: "short"
  }).format(new Date(value));
}

function translateDetailKind(locale: Locale, kind: string) {
  switch (kind) {
    case "thinking":
      return localize(locale, { zh: "思考", en: "Thinking" });
    case "editing":
      return localize(locale, { zh: "编辑", en: "Editing" });
    case "testing":
      return localize(locale, { zh: "测试", en: "Testing" });
    case "tool_call":
      return localize(locale, { zh: "读取/调用", en: "Tool call" });
    case "tool_result":
      return localize(locale, { zh: "读取结果", en: "Tool result" });
    default:
      return localize(locale, { zh: "状态", en: "Status" });
  }
}

function roleLabel(locale: Locale, role: MessageGroup["role"]) {
  switch (role) {
    case "assistant":
      return "Codex";
    case "system_action":
      return localize(locale, { zh: "系统动作", en: "System action" });
    default:
      return localize(locale, { zh: "你", en: "You" });
  }
}

function renderMessageBody(message: MessageGroup["messages"][number]) {
  if (message.body?.trim()) {
    return message.body;
  }

  if (message.title?.trim()) {
    return message.title;
  }

  return "";
}

function LoadingState({ locale }: { locale: Locale }) {
  return (
    <div className={styles.historyLoader}>
      {localize(locale, {
        zh: "正在同步最近消息…",
        en: "Syncing the latest messages..."
      })}
    </div>
  );
}

function MessageDetails({
  locale,
  message
}: {
  locale: Locale;
  message: MessageGroup["messages"][number];
}) {
  if (message.details.length === 0) {
    return null;
  }

  return (
    <details className={styles.messageDetails}>
      <summary>
        {localize(locale, {
          zh: `查看过程与读取 (${message.details.length})`,
          en: `Show process and reads (${message.details.length})`
        })}
      </summary>
      <div className={styles.detailList}>
        {message.details.map((detail) => (
          <details
            key={detail.detail_id ?? `${message.message_id}:${detail.kind}:${detail.timestamp ?? "detail"}`}
            className={styles.detailDisclosure}
          >
            <summary>
              <span>{translateDetailKind(locale, detail.kind)}</span>
              <strong className={styles.detailTitle}>{detail.title}</strong>
              <span>{detail.timestamp ? formatClockTime(locale, detail.timestamp) : null}</span>
            </summary>
            {detail.body ? (
              detail.mono ? (
                <pre className={styles.detailMono}>{detail.body}</pre>
              ) : (
                <p className={styles.detailBody}>{detail.body}</p>
              )
            ) : null}
          </details>
        ))}
      </div>
    </details>
  );
}

function GroupItem({
  group,
  locale,
  onOpenPatchReview,
  pendingApprovalsById
}: {
  group: MessageGroup;
  locale: Locale;
  onOpenPatchReview(patchId: string): void;
  pendingApprovalsById: Map<string, ApprovalRequest>;
}) {
  const isUser = group.role === "user";
  const isSystem = group.role === "system_action";
  const visibleMessages = group.messages.filter((message) => {
    const body = renderMessageBody(message);
    return !(message.is_live_draft && !body.trim() && message.details.length === 0);
  });

  if (isSystem) {
    const leadMessage = visibleMessages[visibleMessages.length - 1] ?? group.messages[group.messages.length - 1];
    const leadBody = renderMessageBody(leadMessage);

    return (
      <article className={styles.systemNotice}>
        <div className={styles.systemNoticeHeader}>
          <div className={styles.systemNoticeCopy}>
            <strong>{leadMessage.title || roleLabel(locale, group.role)}</strong>
            {leadBody ? <p>{leadBody}</p> : null}
          </div>
          <span className={styles.systemNoticeTime}>{formatClockTime(locale, group.ended_at)}</span>
        </div>

        {leadMessage.approval_id ? (
          <p className={styles.systemNoticeMeta}>
            {!pendingApprovalsById.get(leadMessage.approval_id)?.recoverable
              ? localize(locale, {
                  zh: "这条批准请求只能回到桌面 Codex app 处理。",
                  en: "This approval can only be resolved from desktop Codex app now."
                })
              : localize(locale, {
                  zh: "请先处理这条请求，Codex 才会继续。",
                  en: "Handle this request before Codex can continue."
                })}
          </p>
        ) : null}

        {leadMessage.patch_id ? (
          <div className={styles.systemNoticeActions}>
            <button
              className="secondary-button"
              onClick={() => onOpenPatchReview(leadMessage.patch_id!)}
              type="button"
            >
              {localize(locale, { zh: "打开变更审查", en: "Open review" })}
            </button>
          </div>
        ) : null}

        <MessageDetails locale={locale} message={leadMessage} />
      </article>
    );
  }

  if (visibleMessages.length === 0) {
    return null;
  }

  return (
    <article
      className={[
        styles.messageGroup,
        isUser ? styles.messageGroupUser : "",
        group.role === "assistant" ? styles.messageGroupAssistant : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.groupStack}>
        <div className={styles.groupBody}>
          {visibleMessages.map((message) => {
            const body = renderMessageBody(message);
            const hasBody = Boolean(body.trim());

            return (
              <div
                key={message.message_id}
                className={[
                  styles.bubble,
                  isUser ? styles.bubbleUser : "",
                  isSystem ? styles.bubbleSystem : "",
                  message.is_live_draft ? styles.bubbleLive : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {hasBody ? <p className={styles.messageText}>{body}</p> : null}

                <MessageDetails locale={locale} message={message} />
              </div>
            );
          })}
        </div>

        <div className={styles.groupFooter}>{formatClockTime(locale, group.ended_at)}</div>
      </div>
    </article>
  );
}

export function ChatTimeline({
  emptyMessage,
  hasMoreRemoteHistory,
  hiddenItemCount,
  isLoading,
  isLoadingOlder,
  locale,
  onDismissPendingSend,
  onEditPendingSend,
  onOpenPatchReview,
  onRetryPendingSend,
  pendingApprovalsById,
  timelineItems
}: ChatTimelineProps) {
  const showHistoryNote = hiddenItemCount > 0 || hasMoreRemoteHistory || isLoadingOlder;

  if (isLoading && timelineItems.length === 0) {
    return <LoadingState locale={locale} />;
  }

  return (
    <>
      {showHistoryNote ? (
        <div className={styles.historyNote}>
          {isLoadingOlder
            ? localize(locale, {
                zh: "正在加载更早消息…",
                en: "Loading earlier messages..."
              })
            : hiddenItemCount > 0
              ? localize(locale, {
                  zh: `上滑查看更早消息，还有 ${hiddenItemCount} 项在本地窗口外。`,
                  en: `Scroll up for earlier messages. ${hiddenItemCount} more items are hidden above.`
                })
              : localize(locale, {
                  zh: "上滑可继续向服务器拉取更早消息。",
                  en: "Scroll up to request earlier messages from the server."
                })}
        </div>
      ) : null}

      {timelineItems.map((item) => {
        switch (item.type) {
          case "date_divider":
            return (
              <div key={item.id} className={styles.dateDivider}>
                <span>{formatDayLabel(locale, item.timestamp)}</span>
              </div>
            );
          case "message_group":
            return (
              <GroupItem
                key={item.id}
                group={item.group}
                locale={locale}
                onOpenPatchReview={onOpenPatchReview}
                pendingApprovalsById={pendingApprovalsById}
              />
            );
          case "pending_send":
            return (
              <article key={item.id} className={styles.pendingSend}>
                <p className={styles.messageText}>{item.pending_send.body}</p>
                {item.pending_send.skills.length > 0 || item.pending_send.images.length > 0 ? (
                  <div className={styles.pendingMeta}>
                    {item.pending_send.skills.map((skill) => (
                      <span key={skill.path} className={styles.composerChip}>
                        {skill.display_name ?? skill.name}
                      </span>
                    ))}
                    {item.pending_send.images.map((image) => (
                      <span key={image.local_id} className={styles.composerChip}>
                        {image.file_name ?? localize(locale, { zh: "图片", en: "Image" })}
                      </span>
                    ))}
                  </div>
                ) : null}
                {item.pending_send.status === "failed" ? (
                  <>
                    <p className={styles.pendingStatus}>
                      {localize(locale, {
                        zh: "发送失败。你可以重试，或放回输入框修改。",
                        en: "Failed to send. Retry or edit."
                      })}
                    </p>
                    <div className={styles.pendingActions}>
                      <button
                        className="secondary-button"
                        onClick={() => onRetryPendingSend(item.pending_send.local_id)}
                        type="button"
                      >
                        {localize(locale, { zh: "重试", en: "Retry" })}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => onEditPendingSend(item.pending_send.local_id)}
                        type="button"
                      >
                        {localize(locale, { zh: "编辑", en: "Edit" })}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => onDismissPendingSend(item.pending_send.local_id)}
                        type="button"
                      >
                        {localize(locale, { zh: "移除", en: "Dismiss" })}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.groupFooter}>
                    {localize(locale, { zh: "发送中", en: "Sending" })}
                  </div>
                )}
              </article>
            );
          case "live_banner":
            return (
              <article
                key={item.id}
                className={[
                  styles.activityStrip,
                  item.tone === "danger" ? styles.activityStripDanger : "",
                  item.tone === "success" ? styles.activityStripSuccess : "",
                  item.tone === "warning" ? styles.activityStripWarning : "",
                  item.tone === "neutral" ? styles.activityStripNeutral : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className={styles.activityStripCopy}>
                  <strong>
                    {item.live_state.awaiting_native_commit
                      ? localize(locale, {
                          zh: "等待原生确认",
                          en: "Waiting for native confirmation"
                        })
                      : localize(locale, {
                          zh: "Codex 正在继续这条聊天",
                          en: "Codex is continuing this chat"
                        })}
                  </strong>
                  <p>
                    {renderLivePanelBody(
                      locale,
                      item.live_state,
                      item.has_inline_draft
                    )}
                  </p>
                </div>
                <span className={styles.activityStripTime}>
                  {formatClockTime(locale, item.live_state.updated_at)}
                </span>
                {item.live_state.details.length > 0 ? (
                  <details className={styles.messageDetails}>
                    <summary>
                      {localize(locale, {
                        zh: `查看过程与读取 (${item.live_state.details.length})`,
                        en: `Show process and reads (${item.live_state.details.length})`
                      })}
                    </summary>
                    <div className={styles.detailList}>
                      {item.live_state.details.map((detail, index) => (
                        <details
                          key={detail.detail_id ?? `${item.id}:${detail.kind}:${index}`}
                          className={styles.detailDisclosure}
                        >
                          <summary>
                            <span>{translateDetailKind(locale, detail.kind)}</span>
                            <strong className={styles.detailTitle}>{detail.title}</strong>
                            <span>
                              {detail.timestamp
                                ? formatClockTime(locale, detail.timestamp)
                                : null}
                            </span>
                          </summary>
                          {detail.body ? (
                            detail.mono ? (
                              <pre className={styles.detailMono}>{detail.body}</pre>
                            ) : (
                              <p className={styles.detailBody}>{detail.body}</p>
                            )
                          ) : null}
                        </details>
                      ))}
                    </div>
                  </details>
                ) : null}
              </article>
            );
        }
      })}

      {!isLoading && timelineItems.length === 0 ? (
        <div className={styles.historyLoader}>
          {emptyMessage ??
            localize(locale, {
              zh: "这条聊天里还没有消息。",
              en: "No messages yet in this chat."
            })}
        </div>
      ) : null}
    </>
  );
}

export default ChatTimeline;
