"use client";

import Link from "next/link";
import type { CodexOverviewResponse, CodexQueueEntry } from "@codex-remote/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { getCachedOverview, setCachedOverview } from "../lib/client-cache";
import { buildThreadPatchPath, buildThreadPath } from "../lib/codex-paths";
import { getCodexOverview } from "../lib/gateway-client";
import {
  formatDateTime,
  localize,
  translateQueueKind,
  translateStatusText,
  useLocale
} from "../lib/locale";
import {
  describeNativeRequestAttentionLabel,
  describeNativeRequestQueueLabel,
  describePendingInputSummary,
  describeQueueInputPreview,
  isDesktopOrientedNativeRequest
} from "../lib/native-input-copy";
import {
  compareQueueEntriesForMobile,
  getMobileQueuePriority
} from "../lib/mobile-priority";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { CodexShell } from "./codex-shell";

const POLL_INTERVAL_MS = 2_500;

function buildQueueHref(entry: CodexQueueEntry) {
  if (entry.patch_id) {
    return buildThreadPatchPath(entry.thread_id, entry.patch_id);
  }
  return buildThreadPath(entry.thread_id);
}

function getAvatarLabel(value: string) {
  return Array.from(value.trim())[0]?.toUpperCase() ?? "#";
}

function getRepoTail(repoRoot: string) {
  const parts = repoRoot.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? repoRoot;
}

function describeQueuePreview(locale: "zh" | "en", entry: CodexQueueEntry) {
  const detail = entry.summary ?? entry.status;
  switch (entry.kind) {
    case "input":
      return describeQueueInputPreview(
        locale,
        entry.native_request_kind ?? "user_input",
        detail
      );
    case "approval":
      return localize(locale, {
        zh: `新的批准请求到了。${detail}`,
        en: `A fresh approval request came in. ${detail}`
      });
    case "patch":
      return localize(locale, {
        zh: `新的补丁已经准备好。${detail}`,
        en: `A new patch is ready for review. ${detail}`
      });
    case "failed":
      return localize(locale, {
        zh: `这条聊天需要你回来收尾。${detail}`,
        en: `This chat needs you to jump back in. ${detail}`
      });
    default:
      return localize(locale, {
        zh: `Codex 还在继续处理。${detail}`,
        en: `Codex is still working on it. ${detail}`
      });
  }
}

function isDesktopRecoveryInputEntry(entry: CodexQueueEntry) {
  return entry.kind === "input" && isDesktopOrientedNativeRequest(entry.native_request_kind);
}

export function QueueScreen() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [overview, setOverview] = useState<CodexOverviewResponse | null>(() =>
    getCachedOverview()
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!getCachedOverview());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async (background = false) => {
      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      if (background) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const nextOverview = await getCodexOverview();
        if (!cancelled) {
          setOverview(nextOverview);
          setCachedOverview(nextOverview);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        inFlightRef.current = false;
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    void load();
    let interval: number | null = window.setInterval(() => {
      void load(true);
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.hidden) {
        if (interval) {
          window.clearInterval(interval);
          interval = null;
        }
      } else {
        void load(true);
        interval = window.setInterval(() => void load(true), POLL_INTERVAL_MS);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const queue = overview?.queue ?? [];
  const actionableQueue = useMemo(
    () => [...queue].filter((entry) => entry.action_required).sort(compareQueueEntriesForMobile),
    [queue]
  );
  const queueSummary = useMemo(
    () => ({
      inputs: actionableQueue.filter((entry) => entry.kind === "input").length,
      approvals: actionableQueue.filter((entry) => entry.kind === "approval").length,
      patches: actionableQueue.filter((entry) => entry.kind === "patch").length,
      failures: actionableQueue.filter((entry) => entry.kind === "failed").length,
      running: queue.filter((entry) => entry.kind === "running").length
    }),
    [actionableQueue, queue]
  );
  const inputEntries = useMemo(
    () => actionableQueue.filter((entry) => entry.kind === "input"),
    [actionableQueue]
  );
  const desktopRecoveryInputEntries = useMemo(
    () => inputEntries.filter((entry) => isDesktopRecoveryInputEntry(entry)),
    [inputEntries]
  );
  const replyableInputEntries = useMemo(
    () => inputEntries.filter((entry) => !isDesktopRecoveryInputEntry(entry)),
    [inputEntries]
  );
  const otherActionCount = actionableQueue.length - inputEntries.length;
  const leadDesktopRecoveryEntry = desktopRecoveryInputEntries[0] ?? null;
  const desktopRecoverySummary = leadDesktopRecoveryEntry
    ? describePendingInputSummary(
        locale,
        desktopRecoveryInputEntries.length,
        leadDesktopRecoveryEntry.native_request_kind ?? "user_input"
      )
    : null;
  const leadReplyableEntry = replyableInputEntries[0] ?? null;
  const replyableSummary = leadReplyableEntry
    ? describePendingInputSummary(
        locale,
        replyableInputEntries.length,
        leadReplyableEntry.native_request_kind ?? "user_input"
      )
    : null;
  const groupedQueue = useMemo(() => {
    const threadsById = new Map(
      (overview?.threads ?? []).map((thread) => [thread.thread_id, thread])
    );
    const groups = new Map<
      string,
      {
        label: string;
        repoRoot: string;
        entries: CodexQueueEntry[];
      }
    >();

    for (const entry of actionableQueue) {
      const thread = threadsById.get(entry.thread_id);
      const key = thread?.project_id ?? entry.thread_id;
      const current = groups.get(key) ?? {
        label: thread?.project_label ?? entry.thread_id,
        repoRoot: thread?.repo_root ?? entry.thread_id,
        entries: []
      };
      current.entries.push(entry);
      groups.set(key, current);
    }

    return [...groups.values()].sort((left, right) => {
      const leftPriority = getMobileQueuePriority(left.entries[0]);
      const rightPriority = getMobileQueuePriority(right.entries[0]);

      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      const updatedDelta = right.entries[0].timestamp.localeCompare(left.entries[0].timestamp);
      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      return left.label.localeCompare(right.label);
    });
  }, [actionableQueue, overview]);
  const priorityEntries = actionableQueue.filter((entry) => entry.kind !== "input").slice(0, 3);

  function renderPriorityCard(entry: CodexQueueEntry) {
    return (
      <Link
        key={entry.entry_id}
        className={`codex-focus-item ${isDesktopRecoveryInputEntry(entry) ? "is-desktop-recovery" : ""}`}
        href={buildQueueHref(entry)}
        onClick={() => setStoredLastActiveThread(entry.thread_id)}
      >
        <div className="codex-chat-row">
          <div className="codex-chat-avatar">{getAvatarLabel(entry.title)}</div>
          <div className="codex-thread-list-item__body">
            <div className="codex-thread-list-item__head">
              <div>
                <strong>{entry.title}</strong>
                <p className="codex-thread-list-item__preview">
                  {describeQueuePreview(locale, entry)}
                </p>
              </div>
              <div className="codex-thread-list-item__aside">
                <span className="codex-thread-list-item__time">
                  {formatDateTime(locale, entry.timestamp)}
                </span>
                <span className="codex-chat-count">1</span>
              </div>
            </div>
            <div className="codex-focus-item__meta">
              <span className="cue-pill">
                {entry.kind === "input"
                  ? describeNativeRequestQueueLabel(
                      locale,
                      entry.native_request_kind ?? "user_input"
                    )
                  : translateQueueKind(locale, entry.kind)}
              </span>
              {entry.kind === "input" ? (
                <span
                  className={`status-dot ${
                    isDesktopRecoveryInputEntry(entry) ? "tone-warning" : ""
                  }`}
                >
                  {describeNativeRequestAttentionLabel(
                    locale,
                    entry.native_request_kind ?? "user_input"
                  )}
                </span>
              ) : null}
              <span className="status-dot">
                {translateStatusText(locale, entry.status)}
              </span>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <CodexShell
      eyebrow={isZh ? "消息" : "Messages"}
      subtitle={
        isZh
          ? "像聊天应用的待回收件箱一样，需要你点开的事项都会落到这里。"
          : "Like a messaging inbox, anything that needs your tap lands here."
      }
      title={isZh ? "收件箱" : "Inbox"}
      actions={
        <div className="codex-header-cues">
          {desktopRecoveryInputEntries.length > 0 ? (
            <span className="status-dot tone-warning">
              {isZh
                ? `${desktopRecoveryInputEntries.length} 条回桌面`
                : `${desktopRecoveryInputEntries.length} desktop`}
            </span>
          ) : null}
          {replyableInputEntries.length > 0 ? (
            <span className="status-dot">
              {isZh
                ? `${replyableInputEntries.length} 条手机可回`
                : `${replyableInputEntries.length} reply here`}
            </span>
          ) : null}
          {otherActionCount > 0 ? (
            <span className="status-dot">
              {isZh ? `${otherActionCount} 条其它事项` : `${otherActionCount} other`}
            </span>
          ) : null}
          <span className="state-pill">
            {isZh ? `${actionableQueue.length} 项待处理` : `${actionableQueue.length} items`}
          </span>
          {isRefreshing ? (
            <span className="status-dot">
              {localize(locale, { zh: "同步中", en: "Syncing" })}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="codex-page-stack">
        {error ? (
          <section aria-live="assertive" className="codex-status-strip codex-status-strip--stacked tone-danger" role="alert">
            <div className="codex-status-strip__copy">
              <p className="section-label">{isZh ? "连接异常" : "Connection issue"}</p>
              <strong>{isZh ? "收件箱暂时没有同步成功" : "The inbox did not sync this time"}</strong>
              <p>{error}</p>
            </div>
          </section>
        ) : null}

        {leadDesktopRecoveryEntry && desktopRecoverySummary ? (
          <section className="codex-status-strip tone-warning">
            <div className="codex-status-strip__copy">
              <p className="section-label">{desktopRecoverySummary.eyebrow}</p>
              <strong>{desktopRecoverySummary.title}</strong>
              <p>{desktopRecoverySummary.body}</p>
            </div>
            <Link
              className="primary-button"
              href={buildQueueHref(leadDesktopRecoveryEntry)}
              onClick={() => setStoredLastActiveThread(leadDesktopRecoveryEntry.thread_id)}
            >
              {desktopRecoverySummary.cta}
            </Link>
          </section>
        ) : null}

        {leadReplyableEntry && replyableSummary ? (
          <section className="codex-status-strip">
            <div className="codex-status-strip__copy">
              <p className="section-label">{replyableSummary.eyebrow}</p>
              <strong>{replyableSummary.title}</strong>
              <p>{replyableSummary.body}</p>
            </div>
            <Link
              className="secondary-button"
              href={buildQueueHref(leadReplyableEntry)}
              onClick={() => setStoredLastActiveThread(leadReplyableEntry.thread_id)}
            >
              {replyableSummary.cta}
            </Link>
          </section>
        ) : null}

        <section className="codex-status-strip">
          <div className="codex-status-strip__copy">
            <p className="section-label">{isZh ? "快速概览" : "At a glance"}</p>
            <strong>
              {desktopRecoveryInputEntries.length > 0 || replyableInputEntries.length > 0
                ? localize(locale, {
                    zh: `手机可回 ${replyableInputEntries.length} 条，回桌面 ${desktopRecoveryInputEntries.length} 条`,
                    en: `${replyableInputEntries.length} reply here, ${desktopRecoveryInputEntries.length} desktop`
                  })
                : isZh
                  ? `${actionableQueue.length} 项待处理`
                  : `${actionableQueue.length} items waiting`}
            </strong>
            <p>
              {leadDesktopRecoveryEntry && desktopRecoverySummary
                ? desktopRecoverySummary.body
                : leadReplyableEntry && replyableSummary
                  ? replyableSummary.body
                : isZh
                  ? "把它当成聊天里的未读提醒看就行，先点开要你确认和审查的那几条。"
                  : "Think of this like unread alerts: approvals and reviews come first, then failed follow-ups."}
            </p>
          </div>
          <div className="codex-queue-summary">
            <span className="status-dot">
              {isZh
                ? `${replyableInputEntries.length} 条手机可回`
                : `${replyableInputEntries.length} reply here`}
            </span>
            <span className="status-dot">
              {isZh
                ? `${desktopRecoveryInputEntries.length} 条回桌面`
                : `${desktopRecoveryInputEntries.length} desktop`}
            </span>
            <span className="status-dot">{isZh ? `${queueSummary.approvals} 批准` : `${queueSummary.approvals} approvals`}</span>
            <span className="status-dot">{isZh ? `${queueSummary.patches} 审查` : `${queueSummary.patches} reviews`}</span>
            <span className="status-dot">{isZh ? `${queueSummary.failures} 失败` : `${queueSummary.failures} failed`}</span>
            <span className="status-dot">{isZh ? `${queueSummary.running} 运行中` : `${queueSummary.running} running`}</span>
          </div>
        </section>

        {desktopRecoveryInputEntries.length > 0 ? (
          <section className="codex-page-section">
            <div className="codex-page-section__header">
              <div>
                <p className="section-label">
                  {localize(locale, { zh: "桌面恢复", en: "Desktop recovery" })}
                </p>
                <h2>
                  {localize(locale, {
                    zh: "这些聊天建议回桌面继续",
                    en: "These chats usually continue on desktop"
                  })}
                </h2>
              </div>
            </div>
            <div className="codex-inbox-focus">
              {desktopRecoveryInputEntries.slice(0, 3).map((entry) => renderPriorityCard(entry))}
            </div>
          </section>
        ) : null}

        {replyableInputEntries.length > 0 ? (
          <section className="codex-page-section">
            <div className="codex-page-section__header">
              <div>
                <p className="section-label">
                  {localize(locale, { zh: "手机可回", en: "Reply from phone" })}
                </p>
                <h2>
                  {localize(locale, {
                    zh: "这些聊天可以直接在手机完成",
                    en: "You can finish these chats from the phone"
                  })}
                </h2>
              </div>
            </div>
            <div className="codex-inbox-focus">
              {replyableInputEntries.slice(0, 3).map((entry) => renderPriorityCard(entry))}
            </div>
          </section>
        ) : null}

        {priorityEntries.length > 0 ? (
          <section className="codex-page-section">
            <div className="codex-page-section__header">
              <div>
                <p className="section-label">{isZh ? "其它事项" : "Other items"}</p>
                <h2>{isZh ? "这些也要尽快处理" : "These still need attention"}</h2>
              </div>
            </div>
            <div className="codex-inbox-focus">
              {priorityEntries.map((entry) => renderPriorityCard(entry))}
            </div>
          </section>
        ) : null}

        {!isLoading && actionableQueue.length === 0 ? (
          <section className="codex-empty-state">
            <p className="eyebrow">{isZh ? "消息清空" : "Inbox clear"}</p>
            <h2>
              {isZh
                ? "现在没有需要你点开的待办消息。"
                : "No messages need your attention right now."}
            </h2>
            <p>
              {isZh
                ? "你仍然可以回到最近聊天继续看进度，或者检查刚刚完成的对话。"
                : "You can still jump back into recent chats or review conversations that just wrapped up."}
            </p>
          </section>
        ) : null}

        <section className="codex-page-section">
          <div className="codex-page-section__header">
            <div>
              <p className="section-label">
                {localize(locale, { zh: "全部会话", en: "All chats" })}
              </p>
              <h2>{localize(locale, { zh: "按工作区整理", en: "Grouped by workspace" })}</h2>
            </div>
          </div>

          <div className="codex-list-stack">
            {groupedQueue.map((group) => (
              <section key={`${group.label}-${group.repoRoot}`} className="codex-thread-list-card">
                <div className="codex-page-section__header">
                  <div>
                    <p className="workspace-project">{group.label}</p>
                    <h3>{group.repoRoot}</h3>
                  </div>
                  <span className="state-pill">
                    {isZh ? `${group.entries.length} 项` : `${group.entries.length} items`}
                  </span>
                </div>

                <div className="codex-list-stack">
                  {group.entries.map((entry) => (
                    <Link
                      key={entry.entry_id}
                      className={`codex-queue-card ${
                        entry.kind === "input" &&
                        (entry.native_request_kind === "dynamic_tool" ||
                          entry.native_request_kind === "auth_refresh")
                          ? "is-desktop-recovery"
                          : ""
                      }`}
                      href={buildQueueHref(entry)}
                      onClick={() => setStoredLastActiveThread(entry.thread_id)}
                    >
                      <div className="codex-chat-row">
                        <div className="codex-chat-avatar">{getAvatarLabel(entry.title)}</div>
                        <div className="codex-thread-list-item__body">
                          <div className="codex-thread-list-item__head">
                            <div>
                              <strong>{entry.title}</strong>
                              <p className="codex-thread-list-item__preview">
                                {describeQueuePreview(locale, entry)}
                              </p>
                            </div>
                            <div className="codex-thread-list-item__aside">
                              <span className="codex-thread-list-item__time">
                                {formatDateTime(locale, entry.timestamp)}
                              </span>
                              <span className="codex-chat-count">1</span>
                            </div>
                          </div>
                          <div className="codex-thread-card__meta">
                            <span className="cue-pill">
                              {entry.kind === "input"
                                ? describeNativeRequestQueueLabel(
                                    locale,
                                    entry.native_request_kind ?? "user_input"
                                  )
                                : translateQueueKind(locale, entry.kind)}
                            </span>
                            {entry.kind === "input" ? (
                              <span
                                className={`status-dot ${
                                  entry.native_request_kind === "dynamic_tool" ||
                                  entry.native_request_kind === "auth_refresh"
                                    ? "tone-warning"
                                    : ""
                                }`}
                              >
                                {describeNativeRequestAttentionLabel(
                                  locale,
                                  entry.native_request_kind ?? "user_input"
                                )}
                              </span>
                            ) : null}
                            <span className="status-dot">
                              {translateStatusText(locale, entry.status)}
                            </span>
                            <span className="status-dot">{getRepoTail(group.repoRoot)}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </div>
    </CodexShell>
  );
}
