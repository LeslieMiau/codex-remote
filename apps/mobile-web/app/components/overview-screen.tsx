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
  buildThreadPatchPath,
  buildThreadPath
} from "../lib/codex-paths";
import {
  formatDateTime,
  localize,
  translateThreadState,
  useLocale
} from "../lib/locale";
import {
  compareQueueEntriesForMobile,
  compareThreadsForMobile
} from "../lib/mobile-priority";
import {
  describeNativeRequestActionLabel,
  describeNativeRequestQueueLabel,
  describeQueueInputPreview,
  describeThreadPendingInputPreview,
  isDesktopOrientedNativeRequest
} from "../lib/native-input-copy";
import { filterThreadsForQuery } from "../lib/thread-search";
import { setStoredThreadListRoute } from "../lib/thread-list-route-storage";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { ChatsHomeShell } from "./chats-home-shell";
import { NewThreadSheet } from "./new-thread-sheet";
import styles from "./overview-screen.module.css";

const POLL_INTERVAL_MS = 2_000;

function getAvatarLabel(value: string) {
  return Array.from(value.trim())[0]?.toUpperCase() ?? "#";
}

function getRepoTail(repoRoot: string) {
  const parts = repoRoot.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? repoRoot;
}

function buildActionHref(entry: CodexQueueEntry) {
  if (entry.patch_id) {
    return buildThreadPatchPath(entry.thread_id, entry.patch_id);
  }
  return buildThreadPath(entry.thread_id);
}

function getThreadBadgeLabel(locale: "zh" | "en", thread: CodexThread) {
  const pendingCount =
    thread.pending_approvals + thread.pending_patches + thread.pending_native_requests;
  if (pendingCount > 0) {
    return pendingCount > 9 ? "9+" : String(pendingCount);
  }
  if (thread.state === "running") {
    return localize(locale, { zh: "LIVE", en: "LIVE" });
  }
  if (thread.state === "failed" || thread.state === "interrupted") {
    return "!";
  }
  return null;
}

function describeThreadPreview(
  locale: "zh" | "en",
  thread: CodexThread,
  nativeRequestKind?: CodexQueueEntry["native_request_kind"]
) {
  if (thread.archived) {
    return localize(locale, {
      zh: "这条聊天已归档，需要时仍然可以重新打开。",
      en: "This chat is archived, but you can still reopen it when needed."
    });
  }

  if (thread.pending_native_requests > 0) {
    return describeThreadPendingInputPreview(locale, nativeRequestKind);
  }

  if (thread.pending_approvals > 0 && thread.pending_patches > 0) {
    return localize(locale, {
      zh: `${thread.pending_approvals} 个批准和 ${thread.pending_patches} 个补丁在等你看。`,
      en: `${thread.pending_approvals} approvals and ${thread.pending_patches} patch reviews are waiting.`
    });
  }

  if (thread.pending_approvals > 0) {
    return localize(locale, {
      zh: `${thread.pending_approvals} 个批准待确认。`,
      en: `${thread.pending_approvals} approvals are waiting for you.`
    });
  }

  if (thread.pending_patches > 0) {
    return localize(locale, {
      zh: `${thread.pending_patches} 个补丁已经准备好审查。`,
      en: `${thread.pending_patches} patches are ready to review.`
    });
  }

  switch (thread.state) {
    case "running":
      return localize(locale, {
        zh: "Codex 还在这条聊天里继续生成内容。",
        en: "Codex is still typing in this chat."
      });
    case "failed":
      return localize(locale, {
        zh: "上一次处理没有完成，点进来接着收尾。",
        en: "The last run failed. Open this chat to pick it back up."
      });
    case "interrupted":
      return localize(locale, {
        zh: "这条聊天暂停在中途，回来就能继续。",
        en: "This chat paused mid-run. Reopen it to continue."
      });
    case "waiting_input":
      return localize(locale, {
        zh: "Codex 在等你的下一条消息。",
        en: "Codex is waiting for your next message."
      });
    case "waiting_approval":
      return localize(locale, {
        zh: "这条聊天已经发来新的批准请求。",
        en: "This chat has a new approval request."
      });
    case "needs_review":
      return localize(locale, {
        zh: "这条聊天里有新的补丁等你看。",
        en: "There is a patch waiting inside this chat."
      });
    default:
      return localize(locale, {
        zh: "聊天已经同步，可以随时继续。",
        en: "This chat is synced and ready whenever you are."
      });
  }
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
        en: `A new approval request came in. ${detail}`
      });
    case "patch":
      return localize(locale, {
        zh: `新的补丁已经准备好。${detail}`,
        en: `A patch is ready for review. ${detail}`
      });
    case "failed":
      return localize(locale, {
        zh: `这条聊天需要你回来处理。${detail}`,
        en: `This chat needs a follow-up. ${detail}`
      });
    default:
      return localize(locale, {
        zh: `Codex 还在继续。${detail}`,
        en: `Codex is still working. ${detail}`
      });
  }
}

function isDesktopRecoveryInputKind(kind: CodexQueueEntry["native_request_kind"]) {
  return isDesktopOrientedNativeRequest(kind);
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

export function OverviewScreen() {
  const router = useRouter();
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [overview, setOverview] = useState<CodexOverviewResponse | null>(() =>
    getCachedOverview()
  );
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!getCachedOverview());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isNewThreadOpen, setIsNewThreadOpen] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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
        const nextOverview = await getCodexOverview({
          includeArchived: showArchived
        });
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
  }, [showArchived]);

  const filteredThreads = useMemo(
    () => filterThreadsForQuery(overview?.threads ?? [], threadQuery),
    [overview, threadQuery]
  );
  const visibleThreads = useMemo(
    () => [...filteredThreads].sort(compareThreadsForMobile),
    [filteredThreads]
  );
  const matchingThreadCount = visibleThreads.length;
  const actionableQueue = useMemo(
    () =>
      [...(overview?.queue ?? [])]
        .filter((entry) => entry.action_required)
        .sort(compareQueueEntriesForMobile),
    [overview]
  );
  const topPriorityEntry = actionableQueue[0] ?? null;
  const actionRequiredCount = actionableQueue.length;
  const runningCount =
    overview?.threads.filter((thread) => thread.state === "running").length ?? 0;
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

  const subtitle = error
    ? localize(locale, {
        zh: "最近对话暂时没有同步完整，当前优先展示可用内容。",
        en: "Recent chats did not sync cleanly, so the latest available content stays on screen."
      })
    : actionRequiredCount > 0
      ? localize(locale, {
          zh: `${actionRequiredCount} 条待处理消息，最近对话都在这里。`,
          en: `${actionRequiredCount} waiting items, with recent chats right below.`
        })
      : runningCount > 0
        ? localize(locale, {
            zh: `${runningCount} 条对话还在进行中。`,
            en: `${runningCount} chats are still running.`
          })
        : localize(locale, {
            zh: "最近对话、待处理消息和新聊天入口都在这里。",
            en: "Recent conversations, waiting items, and new chat entry all live here."
          });

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
    const badgeLabel = getThreadBadgeLabel(locale, thread);
    const stateLabel =
      thread.state === "ready" ? null : translateThreadState(locale, thread.state);

    return (
      <Link
        key={thread.thread_id}
        className={`${styles.threadRow} ${
          thread.state === "running" ? styles.threadRowLive : ""
        } ${thread.archived ? styles.threadRowArchived : ""}`}
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
            <div className={styles.threadTitleWrap}>
              <strong>{thread.title}</strong>
              <p className={styles.threadPreview}>
                {describeThreadPreview(locale, thread, pendingInputKind)}
              </p>
            </div>
            <div className={styles.threadAside}>
              <span className={styles.threadTime}>{formatDateTime(locale, thread.updated_at)}</span>
              {badgeLabel ? <span className={styles.threadBadge}>{badgeLabel}</span> : null}
            </div>
          </div>
          <div className={styles.threadMeta}>
            <span className={styles.metaTag}>{thread.project_label}</span>
            <span className={styles.metaTag}>{getRepoTail(thread.repo_root)}</span>
            {stateLabel ? <span className={styles.metaTag}>{stateLabel}</span> : null}
            {thread.archived ? (
              <span className={styles.metaTag}>
                {localize(locale, { zh: "已归档", en: "Archived" })}
              </span>
            ) : null}
            {pendingInputKind ? (
              <span
                className={`${styles.metaTag} ${
                  isDesktopRecoveryInputKind(pendingInputKind) ? styles.metaTagWarning : ""
                }`}
              >
                {describeNativeRequestQueueLabel(locale, pendingInputKind)}
              </span>
            ) : null}
          </div>
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
        subtitle={subtitle}
        title={isZh ? "聊天" : "Chats"}
        actions={
          <div className={styles.headerActions}>
            <Link className={styles.headerButton} href="/queue">
              <span>{isZh ? "收件箱" : "Inbox"}</span>
              {actionRequiredCount > 0 ? (
                <span className={styles.headerButtonBadge}>
                  {actionRequiredCount > 9 ? "9+" : actionRequiredCount}
                </span>
              ) : null}
            </Link>
            {capabilities?.shared_thread_create ? (
              <button
                className={styles.headerButtonPrimary}
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

          {topPriorityEntry && !hasThreadSearch ? (
            <section className={styles.notice}>
              <div className={styles.noticeCopy}>
                <p className={styles.noticeLabel}>
                  {localize(locale, { zh: "待处理消息", en: "Waiting item" })}
                </p>
                <strong>{topPriorityEntry.title}</strong>
                <p>{describeQueuePreview(locale, topPriorityEntry)}</p>
              </div>
              <Link
                className={styles.noticeAction}
                href={buildActionHref(topPriorityEntry)}
                onClick={() => {
                  setStoredThreadListRoute("/projects");
                  setStoredLastActiveThread(topPriorityEntry.thread_id);
                }}
              >
                {topPriorityEntry.kind === "input"
                  ? describeNativeRequestActionLabel(
                      locale,
                      topPriorityEntry.native_request_kind ?? "user_input"
                    )
                  : localize(locale, { zh: "去处理", en: "Handle" })}
              </Link>
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
            <div className={styles.toolbarMeta}>
              {hasThreadSearch ? (
                <button
                  className={styles.clearButton}
                  onClick={() => setThreadQuery("")}
                  type="button"
                >
                  {isZh ? "清空" : "Clear"}
                </button>
              ) : null}
              <button
                className={`${styles.filterButton} ${
                  showArchived ? styles.filterButtonActive : ""
                }`}
                onClick={() => setShowArchived((current) => !current)}
                type="button"
              >
                {showArchived
                  ? localize(locale, { zh: "隐藏归档", en: "Hide archived" })
                  : localize(locale, { zh: "显示归档", en: "Show archived" })}
              </button>
            </div>
          </section>

          <div className={styles.summaryRow}>
            <span
              className={`${styles.summaryPill} ${
                actionRequiredCount > 0 ? styles.summaryPillAccent : ""
              }`}
            >
              {actionRequiredCount > 0
                ? localize(locale, {
                    zh: `${actionRequiredCount} 条待处理`,
                    en: `${actionRequiredCount} waiting`
                  })
                : localize(locale, {
                    zh: "当前没有待处理消息",
                    en: "No waiting items"
                  })}
            </span>
            <span className={styles.summaryPill}>
              {localize(locale, {
                zh: `${runningCount} 条进行中`,
                en: `${runningCount} active`
              })}
            </span>
            {hasThreadSearch ? (
              <span className={styles.summaryPill}>
                {localize(locale, {
                  zh:
                    matchingThreadCount > 0
                      ? `找到 ${matchingThreadCount} 条聊天`
                      : "没有找到匹配聊天",
                  en:
                    matchingThreadCount > 0
                      ? `${matchingThreadCount} matching chats`
                      : "No matching chats"
                })}
              </span>
            ) : null}
            {isRefreshing ? (
              <span className={styles.summaryPill}>
                {localize(locale, { zh: "同步中", en: "Syncing" })}
              </span>
            ) : null}
          </div>

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
                {showArchived
                  ? localize(locale, { zh: "聊天列表", en: "Chat list" })
                  : localize(locale, { zh: "按最近活跃排序", en: "Sorted by recent activity" })}
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
              <p>
                {hasThreadSearch
                  ? localize(locale, {
                      zh: "没有找到匹配聊天。",
                      en: "No matching chats."
                    })
                  : showArchived
                    ? localize(locale, {
                        zh: "当前没有归档聊天。",
                        en: "There are no archived chats right now."
                      })
                    : localize(locale, {
                        zh: "还没有共享聊天。",
                        en: "There are no shared chats yet."
                      })}
              </p>
              <h2>
                {hasThreadSearch
                  ? localize(locale, {
                      zh: "换个关键词再试试。",
                      en: "Try a different keyword."
                    })
                  : localize(locale, {
                      zh: "从这里开始第一条对话。",
                      en: "Start the first conversation from here."
                    })}
              </h2>
              <p>
                {hasThreadSearch
                  ? localize(locale, {
                      zh: "可以继续按标题、项目名或仓库路径搜索。",
                      en: "Search by title, project name, or repo path."
                    })
                  : localize(locale, {
                      zh: "新聊天会直接连到共享 Codex 会话。",
                      en: "A new chat opens the shared Codex conversation directly."
                    })}
              </p>
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
