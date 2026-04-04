"use client";

import Link from "next/link";
import type {
  CodexOverviewResponse,
  CodexQueueEntry,
  CodexThread
} from "@codex-remote/protocol";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { createSharedThread, getCodexOverview } from "../lib/gateway-client";
import {
  getCachedOverview,
  setCachedCapabilities,
  setCachedOverview
} from "../lib/client-cache";
import {
  buildThreadPath
} from "../lib/codex-paths";
import {
  formatDateTime,
  localize,
  useLocale
} from "../lib/locale";
import {
  compareQueueEntriesForMobile,
  compareThreadsForMobile
} from "../lib/mobile-priority";
import {
  describeQueueInputPreview,
  describeNativeRequestQueueLabel,
  describeThreadPendingInputPreview
} from "../lib/native-input-copy";
import { filterThreadsForQuery } from "../lib/thread-search";
import { setStoredThreadListRoute } from "../lib/thread-list-route-storage";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import {
  buildMobileThreadListLines,
  getDisplayThreadTitle,
  isRecoveryFallbackThread,
  shouldHideThreadFromMobileList
} from "../lib/chat-thread-presentation";
import { ChatsHomeShell } from "./chats-home-shell";
import { NewThreadSheet } from "./new-thread-sheet";
import { buildOverviewEmptyStateCopy } from "./shared-empty-state-presentation";
import styles from "./overview-screen.module.css";

const POLL_INTERVAL_MS = 2_000;

function getAvatarLabel(value: string) {
  return Array.from(value.trim())[0]?.toUpperCase() ?? "#";
}

function getThreadBadgeLabel(thread: CodexThread) {
  const pendingCount =
    thread.pending_approvals + thread.pending_patches + thread.pending_native_requests;
  if (pendingCount > 0) {
    return pendingCount > 9 ? "9+" : String(pendingCount);
  }
  if (thread.state === "failed" || thread.state === "system_error") {
    return "!";
  }
  return null;
}

function describeThreadPreview(
  locale: "zh" | "en",
  thread: CodexThread,
  nativeRequestKind?: CodexQueueEntry["native_request_kind"]
) {
  if (thread.pending_native_requests > 0) {
    return describeThreadPendingInputPreview(locale, nativeRequestKind);
  }

  if (thread.pending_approvals > 0) {
    return localize(locale, {
      zh: "等待批准",
      en: "Approval needed"
    });
  }

  if (thread.pending_patches > 0) {
    return localize(locale, {
      zh: "等待审查",
      en: "Review needed"
    });
  }

  if (thread.state === "failed" || thread.state === "system_error") {
    return localize(locale, {
      zh: "需要重新处理",
      en: "Needs follow-up"
    });
  }

  return "";
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="m17 17 3.5 3.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M4.5 6.5h15v8.75l-2.4 2.75h-2.85l-1.4-1.85h-1.7L9.75 18H6.9l-2.4-2.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 14.5h4.2l1.45 1.8h3.7l1.45-1.8h4.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M6 7.5h6.5M6 12h12M6 16.5h8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m15.25 5.25 3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M14 10 18.75 5.25 20.75 7.25 16 12H14Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function OverviewScreen() {
  const router = useRouter();
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const inboxLabel = isZh ? "收件箱" : "Inbox";
  const newChatLabel = isZh ? "新聊天" : "New chat";
  const [overview, setOverview] = useState<CodexOverviewResponse | null>(() =>
    getCachedOverview()
  );
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!getCachedOverview());
  const [, setIsRefreshing] = useState(false);
  const [isNewThreadOpen, setIsNewThreadOpen] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setStoredThreadListRoute("/projects");
  }, []);

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
          setCachedCapabilities(nextOverview.capabilities);
          setLastSuccessfulSyncAt(new Date().toISOString());
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
    let interval: ReturnType<typeof setInterval> | null = setInterval(() => {
      void load(true);
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.hidden) {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      } else {
        void load(true);
        interval = setInterval(() => void load(true), POLL_INTERVAL_MS);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const filteredThreads = useMemo(
    () => filterThreadsForQuery(overview?.threads ?? [], threadQuery),
    [overview, threadQuery]
  );
  const visibleThreads = useMemo(
    () =>
      [...filteredThreads]
        .filter((thread) => !shouldHideThreadFromMobileList(thread))
        .sort(compareThreadsForMobile),
    [filteredThreads]
  );
  const matchingThreadCount = visibleThreads.length;
  const isFallbackOnlyOverview = useMemo(() => {
    if (!overview) {
      return false;
    }

    return (
      overview.capabilities.shared_state_available === false &&
      overview.threads.length > 0 &&
      overview.threads.every((thread) => isRecoveryFallbackThread(thread))
    );
  }, [overview]);
  const actionableQueue = useMemo(
    () =>
      [...(overview?.queue ?? [])]
        .filter((entry) => entry.action_required)
        .sort(compareQueueEntriesForMobile),
    [overview]
  );
  const actionRequiredCount = actionableQueue.length;
  const pendingInputKindsByThreadId = useMemo(() => {
    const kinds = new Map<string, CodexQueueEntry["native_request_kind"]>();

    for (const entry of actionableQueue) {
      if (entry.kind === "input" && !kinds.has(entry.thread_id)) {
        kinds.set(entry.thread_id, entry.native_request_kind);
      }
    }

    return kinds;
  }, [actionableQueue]);
  const capabilities = overview?.capabilities;
  const hasThreadSearch = threadQuery.trim().length > 0;
  const overviewEmptyState = useMemo(
    () =>
      buildOverviewEmptyStateCopy({
        hasThreadSearch,
        isFallbackOnlyOverview,
        locale,
        reason: overview?.capabilities.reason
      }),
    [hasThreadSearch, isFallbackOnlyOverview, locale, overview?.capabilities.reason]
  );

  async function handleCreateThread(input: { prompt: string; repoRoot: string }) {
    setIsCreatingThread(true);
    setCreateError(null);

    try {
      const created = await createSharedThread({
        repoRoot: input.repoRoot,
        prompt: input.prompt
      });
      setStoredThreadListRoute("/projects");
      setStoredLastActiveThread(created.thread.thread_id);
      setIsNewThreadOpen(false);
      router.push(buildThreadPath(created.thread.thread_id));
    } catch (createThreadError) {
      setCreateError(
        createThreadError instanceof Error ? createThreadError.message : String(createThreadError)
      );
    } finally {
      setIsCreatingThread(false);
    }
  }

  function renderThreadRow(thread: CodexThread) {
    const pendingInputKind = pendingInputKindsByThreadId.get(thread.thread_id);
    const badgeLabel = getThreadBadgeLabel(thread);
    const preview = describeThreadPreview(locale, thread, pendingInputKind);
    const displayTitle = getDisplayThreadTitle(locale, thread);
    const blockingTag =
      thread.pending_native_requests > 0
        ? describeNativeRequestQueueLabel(locale, pendingInputKind ?? "user_input")
        : thread.pending_approvals > 0
          ? localize(locale, { zh: "待批准", en: "Approval" })
          : thread.pending_patches > 0
            ? localize(locale, { zh: "待审查", en: "Review" })
            : thread.state === "failed" || thread.state === "system_error"
              ? localize(locale, { zh: "失败", en: "Failed" })
              : null;
    const { secondaryLine, tertiaryLine } = buildMobileThreadListLines({
      displayTitle,
      preview,
      project_label: thread.project_label,
      repo_root: thread.repo_root,
      statusLabel: blockingTag
    });

    return (
      <Link
        key={thread.thread_id}
        className={styles.threadRow}
        data-thread-row={thread.thread_id}
        href={buildThreadPath(thread.thread_id)}
        onClick={() => {
          setStoredThreadListRoute("/projects");
          setStoredLastActiveThread(thread.thread_id);
        }}
      >
        <div className={styles.threadAvatar}>
          {getAvatarLabel(thread.project_label || thread.title)}
        </div>
        <div className={styles.threadBody}>
          <div className={styles.threadHead}>
            <strong className={styles.threadTitle}>{displayTitle}</strong>
            <div className={styles.threadAside}>
              <span className={styles.threadTime}>{formatDateTime(locale, thread.updated_at)}</span>
              {badgeLabel ? <span className={styles.threadBadge}>{badgeLabel}</span> : null}
            </div>
          </div>
          {secondaryLine ? <p className={styles.threadPreview}>{secondaryLine}</p> : null}
          {tertiaryLine ? <p className={styles.threadMetaLine}>{tertiaryLine}</p> : null}
        </div>
      </Link>
    );
  }

  function renderLoadingRows() {
    return (
      <div aria-hidden="true" className={styles.loadingList}>
        {Array.from({ length: 5 }, (_, index) => (
          <div className={styles.loadingRow} key={index}>
            <div className={styles.loadingAvatar} />
            <div className={styles.loadingCopy}>
              <div className={`${styles.loadingLine} ${styles.loadingLinePrimary}`} />
              <div className={`${styles.loadingLine} ${styles.loadingLineSecondary}`} />
              <div className={styles.loadingMeta}>
                <div className={styles.loadingChip} />
                <div className={styles.loadingChip} />
              </div>
            </div>
            <div className={`${styles.loadingLine} ${styles.loadingLineTertiary}`} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <ChatsHomeShell
        title={isZh ? "聊天" : "Chats"}
        actions={
          <div className={styles.headerActions}>
            <Link
              aria-label={inboxLabel}
              className={styles.headerIconButton}
              data-overview-action="inbox"
              href="/queue"
              title={inboxLabel}
            >
              <InboxIcon />
              {actionRequiredCount > 0 ? (
                <span className={styles.headerButtonBadge}>
                  {actionRequiredCount > 9 ? "9+" : actionRequiredCount}
                </span>
              ) : null}
            </Link>
            {capabilities?.shared_thread_create ? (
              <button
                aria-label={newChatLabel}
                className={styles.headerIconButtonPrimary}
                data-overview-action="new-chat"
                disabled={isCreatingThread}
                onClick={() => {
                  setCreateError(null);
                  setIsNewThreadOpen(true);
                }}
                title={newChatLabel}
                type="button"
              >
                <NewChatIcon />
              </button>
            ) : null}
          </div>
        }
      >
        <div className={styles.page} data-overview-screen="chat-list">
          {error ? (
            <section
              aria-live="assertive"
              className={`${styles.notice} ${
                overview ? styles.noticeWarning : styles.noticeDanger
              }`}
              role="alert"
            >
              <div className={styles.noticeCopy}>
                <p className={styles.noticeLabel}>
                  {overview
                    ? localize(locale, {
                        zh: "显示缓存内容",
                        en: "Showing cached chats"
                      })
                    : localize(locale, {
                        zh: "连接异常",
                        en: "Connection issue"
                      })}
                </p>
                <strong>
                  {overview
                    ? localize(locale, {
                        zh: "最近对话这次没同步成功，先继续显示上一份内容。",
                        en: "This refresh failed, so the last synced chats are still on screen."
                      })
                    : localize(locale, {
                        zh: "最近对话暂时没有同步成功。",
                        en: "Recent chats did not sync this time."
                      })}
                </strong>
                <p>
                  {overview
                    ? localize(locale, {
                        zh: lastSuccessfulSyncAt
                          ? `上次成功同步时间：${formatDateTime(locale, lastSuccessfulSyncAt)}。${error}`
                          : `当前先展示已缓存的聊天列表。${error}`,
                        en: lastSuccessfulSyncAt
                          ? `Last successful sync: ${formatDateTime(locale, lastSuccessfulSyncAt)}. ${error}`
                          : `Showing the cached chat list for now. ${error}`
                      })
                    : error}
                </p>
              </div>
            </section>
          ) : null}

          <section className={styles.toolbar}>
            <label className={styles.searchField}>
              <SearchIcon />
              <input
                onChange={(event) => setThreadQuery(event.target.value)}
                placeholder={
                  isZh ? "搜索标题、项目名或仓库路径" : "Search title, project, or repo path"
                }
                type="search"
                value={threadQuery}
              />
            </label>
            {hasThreadSearch ? (
              <button
                className={styles.clearButton}
                onClick={() => setThreadQuery("")}
                type="button"
              >
                {isZh ? "清空" : "Clear"}
              </button>
            ) : null}
          </section>

          {createError ? (
            <section
              aria-live="assertive"
              className={`${styles.notice} ${styles.noticeDanger}`}
              role="alert"
            >
              <div className={styles.noticeCopy}>
                <p className={styles.noticeLabel}>
                  {localize(locale, { zh: "新聊天失败", en: "Failed to start chat" })}
                </p>
                <strong>
                  {localize(locale, {
                    zh: "这次没有成功创建共享聊天。",
                    en: "A shared chat was not created this time."
                  })}
                </strong>
                <p>{createError}</p>
              </div>
            </section>
          ) : null}

          <div className={styles.listHeader}>
            <div className={styles.listHeaderCopy}>
              <p className={styles.listLabel}>
                {hasThreadSearch
                  ? localize(locale, { zh: "搜索结果", en: "Search results" })
                  : localize(locale, { zh: "最近聊天", en: "Recent chats" })}
              </p>
              <h2>
                {hasThreadSearch
                  ? localize(locale, { zh: "匹配会话", en: "Matching chats" })
                  : localize(locale, { zh: "会话列表", en: "Conversations" })}
              </h2>
            </div>
            <span className={styles.listCount}>
              {isLoading && !overview
                ? localize(locale, { zh: "正在加载", en: "Loading" })
                : localize(locale, {
                    zh: `${matchingThreadCount} 条聊天`,
                    en: `${matchingThreadCount} chats`
                  })}
            </span>
          </div>

          {isLoading && !overview ? (
            renderLoadingRows()
          ) : visibleThreads.length > 0 ? (
            <div className={styles.list}>
              {visibleThreads.map((thread) => renderThreadRow(thread))}
            </div>
          ) : (
            <section className={styles.emptyState}>
              <p>{overviewEmptyState.body}</p>
              <h2>{overviewEmptyState.title}</h2>
              <p>{overviewEmptyState.detail}</p>
              <div className={styles.emptyActions}>
                {capabilities?.shared_thread_create ? (
                  <button
                    className={styles.emptyActionPrimary}
                    disabled={isCreatingThread}
                    onClick={() => {
                      setCreateError(null);
                      setIsNewThreadOpen(true);
                    }}
                    type="button"
                  >
                    {isZh ? "新聊天" : "New chat"}
                  </button>
                ) : null}
                <Link className={styles.emptyAction} href="/queue">
                  {isZh ? "查看收件箱" : "View inbox"}
                </Link>
              </div>
            </section>
          )}
        </div>
      </ChatsHomeShell>

      <NewThreadSheet
        disableDismiss={isCreatingThread}
        error={createError}
        isSubmitting={isCreatingThread}
        onClose={() => setIsNewThreadOpen(false)}
        onSubmit={handleCreateThread}
        open={isNewThreadOpen}
        projects={overview?.projects ?? []}
      />
    </>
  );
}
