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
  translateQueueKind,
  translateThreadState,
  useLocale
} from "../lib/locale";
import {
  compareQueueEntriesForMobile,
  compareThreadsForMobile
} from "../lib/mobile-priority";
import {
  describeNativeRequestActionLabel,
  describeNativeRequestAttentionLabel,
  describeNativeRequestQueueLabel,
  describeQueueInputPreview,
  describeThreadPendingInputPreview,
  isDesktopOrientedNativeRequest
} from "../lib/native-input-copy";
import { filterThreadsForQuery } from "../lib/thread-search";
import { setStoredThreadListRoute } from "../lib/thread-list-route-storage";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { CodexShell } from "./codex-shell";
import { NewThreadSheet } from "./new-thread-sheet";
import { SkeletonCard } from "./skeleton";

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
  const latestThread = visibleThreads[0] ?? null;
  const topPriorityEntry = actionableQueue[0] ?? null;
  const actionRequiredCount = actionableQueue.length;
  const runningCount =
    overview?.threads.filter((thread) => thread.state === "running").length ?? 0;
  const desktopRecoveryInputEntries = useMemo(
    () =>
      actionableQueue.filter(
        (entry) =>
          entry.kind === "input" &&
          isDesktopRecoveryInputKind(entry.native_request_kind)
      ),
    [actionableQueue]
  );
  const replyableInputEntries = useMemo(
    () =>
      actionableQueue.filter(
        (entry) =>
          entry.kind === "input" &&
          !isDesktopRecoveryInputKind(entry.native_request_kind)
      ),
    [actionableQueue]
  );
  const otherActionCount = Math.max(
    0,
    actionRequiredCount - desktopRecoveryInputEntries.length - replyableInputEntries.length
  );
  const topPriorityInputKind =
    topPriorityEntry?.kind === "input"
      ? topPriorityEntry.native_request_kind ?? "user_input"
      : undefined;
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
        className={`codex-thread-row ${
          thread.state === "running" ? "is-live" : ""
        } ${thread.archived ? "is-archived" : ""} ${
          isDesktopRecoveryInputKind(pendingInputKind) ? "is-desktop-recovery" : ""
        }`}
        href={buildThreadPath(thread.thread_id)}
        onClick={() => {
          setStoredThreadListRoute("/projects");
          setStoredLastActiveThread(thread.thread_id);
        }}
      >
        <div className="codex-thread-row__avatar">
          {getAvatarLabel(thread.project_label)}
        </div>
        <div className="codex-thread-row__content">
          <div className="codex-thread-row__head">
            <div className="codex-thread-row__title-wrap">
              <strong>{thread.title}</strong>
              <p>{describeThreadPreview(locale, thread, pendingInputKind)}</p>
            </div>
            <div className="codex-thread-row__aside">
              <span className="codex-thread-row__time">
                {formatDateTime(locale, thread.updated_at)}
              </span>
              {badgeLabel ? <span className="codex-thread-row__badge">{badgeLabel}</span> : null}
            </div>
          </div>
          <div className="codex-thread-row__meta">
            <span className="status-dot">{thread.project_label}</span>
            <span className="status-dot">{getRepoTail(thread.repo_root)}</span>
            {stateLabel ? <span className="status-dot">{stateLabel}</span> : null}
            {thread.archived ? (
              <span className="status-dot">
                {localize(locale, { zh: "已归档", en: "Archived" })}
              </span>
            ) : null}
            {pendingInputKind ? (
              <span
                className={`status-dot ${
                  isDesktopRecoveryInputKind(pendingInputKind) ? "tone-warning" : ""
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

  return (
    <>
      <CodexShell
        eyebrow={isZh ? "聊天" : "Chats"}
        subtitle={
          isZh
            ? "像微信和 Telegram 一样，最近对话、待处理消息和新聊天入口都聚合在这里。"
            : "Like WeChat or Telegram, your recent chats, urgent inbox items, and new chat entry point all live here."
        }
        title={isZh ? "最近对话" : "Recent chats"}
        actions={
          <div className="codex-header-cues">
            <Link className="chrome-button codex-inbox-button" href="/queue">
              <span>{isZh ? "收件箱" : "Inbox"}</span>
              {actionRequiredCount > 0 ? (
                <span className="codex-inbox-button__badge">
                  {actionRequiredCount > 9 ? "9+" : actionRequiredCount}
                </span>
              ) : null}
            </Link>
            {capabilities?.shared_thread_create ? (
              <button
                className="chrome-button"
                disabled={isCreatingThread}
                onClick={() => setIsNewThreadOpen(true)}
                type="button"
              >
                {isZh ? "新聊天" : "New chat"}
              </button>
            ) : null}
            <button
              className="chrome-button"
              onClick={() => setShowArchived((current) => !current)}
              type="button"
            >
              {showArchived
                ? localize(locale, { zh: "隐藏归档", en: "Hide archived" })
                : localize(locale, { zh: "显示归档", en: "Show archived" })}
            </button>
            {isRefreshing ? (
              <span className="status-dot">{isZh ? "同步中" : "Syncing"}</span>
            ) : null}
          </div>
        }
      >
        {isLoading && !overview ? (
          <div className="codex-page-stack">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="codex-page-stack codex-page-stack--home">
            {error ? (
              <section
                aria-live="assertive"
                className={`codex-status-strip codex-status-strip--stacked ${
                  overview ? "tone-warning" : "tone-danger"
                }`}
                role="alert"
              >
                <div className="codex-status-strip__copy">
                  <p className="section-label">
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
                          zh: "最近对话暂时没有同步成功",
                          en: "Recent chats did not sync this time"
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

            <section className="codex-home-hero">
              <div className="codex-home-hero__copy">
                <p className="section-label">
                  {topPriorityInputKind
                    ? describeNativeRequestAttentionLabel(locale, topPriorityInputKind)
                    : isZh
                      ? "最近聊天"
                      : "Recent chats"}
                </p>
                <strong>
                  {topPriorityEntry
                    ? topPriorityEntry.title
                    : latestThread
                      ? latestThread.title
                      : localize(locale, {
                          zh: "从手机发起第一条共享聊天",
                          en: "Start the first shared chat from your phone"
                        })}
                </strong>
                <p>
                  {topPriorityEntry
                    ? describeQueuePreview(locale, topPriorityEntry)
                    : latestThread
                      ? localize(locale, {
                          zh: `最近活跃于 ${formatDateTime(locale, latestThread.updated_at)}，点进去就能接着聊。`,
                          en: `Active ${formatDateTime(locale, latestThread.updated_at)}. Open it and keep the conversation going.`
                        })
                      : localize(locale, {
                          zh: "这里会像聊天应用一样显示最近对话，优先把待回复和待处理消息放在前面。",
                          en: "This screen behaves like a chat app: recent conversations stay front and center, with waiting items surfaced first."
                        })}
                </p>
              </div>

              <div className="codex-home-hero__pills">
                {replyableInputEntries.length > 0 ? (
                  <span className="status-dot">
                    {isZh
                      ? `${replyableInputEntries.length} 条手机可回`
                      : `${replyableInputEntries.length} reply here`}
                  </span>
                ) : null}
                {desktopRecoveryInputEntries.length > 0 ? (
                  <span className="status-dot tone-warning">
                    {isZh
                      ? `${desktopRecoveryInputEntries.length} 条回桌面`
                      : `${desktopRecoveryInputEntries.length} desktop`}
                  </span>
                ) : null}
                {otherActionCount > 0 ? (
                  <span className="status-dot">
                    {isZh ? `${otherActionCount} 条其它事项` : `${otherActionCount} other`}
                  </span>
                ) : null}
                <span className="status-dot">
                  {isZh ? `${runningCount} 条进行中` : `${runningCount} active`}
                </span>
              </div>

              <div className="codex-home-hero__actions">
                {topPriorityEntry ? (
                  <Link
                    className="primary-button"
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
                      : localize(locale, { zh: "马上处理", en: "Open now" })}
                  </Link>
                ) : latestThread ? (
                  <Link
                    className="primary-button"
                    href={buildThreadPath(latestThread.thread_id)}
                    onClick={() => {
                      setStoredThreadListRoute("/projects");
                      setStoredLastActiveThread(latestThread.thread_id);
                    }}
                  >
                    {isZh ? "继续聊天" : "Continue chat"}
                  </Link>
                ) : capabilities?.shared_thread_create ? (
                  <button
                    className="primary-button"
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

                <Link className="secondary-button" href="/queue">
                  {actionRequiredCount > 0
                    ? localize(locale, { zh: "打开收件箱", en: "Open inbox" })
                    : localize(locale, { zh: "查看收件箱", en: "View inbox" })}
                </Link>
              </div>
            </section>

            <section className="codex-page-card codex-page-card--plain threads-home__search-card">
              <div className="threads-home__search-row">
                <label className="codex-form-field threads-home__search-field">
                  <span className="section-label">{isZh ? "查找聊天" : "Find a chat"}</span>
                  <input
                    className="chrome-input"
                    onChange={(event) => setThreadQuery(event.target.value)}
                    placeholder={
                      isZh
                        ? "按标题、工作区或仓库路径搜索"
                        : "Search by title, workspace, or repo path"
                    }
                    type="search"
                    value={threadQuery}
                  />
                </label>
                {hasThreadSearch ? (
                  <button
                    className="chrome-button"
                    onClick={() => setThreadQuery("")}
                    type="button"
                  >
                    {isZh ? "清空" : "Clear"}
                  </button>
                ) : null}
              </div>
              <p className="threads-home__search-note">
                {localize(locale, {
                  zh: "想找旧聊天时，直接搜标题、项目名或仓库路径就行。",
                  en: "Search by title, project name, or repo path when you need an older thread."
                })}
              </p>
              {hasThreadSearch ? (
                <div className="codex-inline-pills threads-home__search-meta">
                  <span className="status-dot">
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
                </div>
              ) : null}
            </section>

            {createError ? (
              <section
                aria-live="assertive"
                className="codex-status-strip codex-status-strip--stacked tone-danger"
                role="alert"
              >
                <div className="codex-status-strip__copy">
                  <p className="section-label">{isZh ? "新聊天失败" : "Failed to start chat"}</p>
                  <strong>
                    {isZh ? "这次没有成功创建共享聊天。" : "A shared chat was not created this time."}
                  </strong>
                  <p>{createError}</p>
                </div>
              </section>
            ) : null}

            <section className="codex-list-section">
              <div className="codex-list-section__head">
                <div>
                  <p className="section-label">{isZh ? "最近聊天" : "Recent chats"}</p>
                  <h2>
                    {hasThreadSearch
                      ? localize(locale, { zh: "搜索结果", en: "Search results" })
                      : localize(locale, { zh: "按最近活跃排序", en: "Sorted by recent activity" })}
                  </h2>
                </div>
                <span className="state-pill">
                  {isZh ? `${matchingThreadCount} 条聊天` : `${matchingThreadCount} chats`}
                </span>
              </div>

              {visibleThreads.length > 0 ? (
                <div className="codex-thread-list">
                  {visibleThreads.map((thread) => renderThreadRow(thread))}
                </div>
              ) : (
                <section className="codex-empty-state">
                  <p className="eyebrow">
                    {hasThreadSearch
                      ? isZh
                        ? "没有匹配聊天"
                        : "No matching chats"
                      : showArchived
                        ? isZh
                          ? "归档为空"
                          : "No archived chats"
                        : isZh
                          ? "还没有聊天"
                          : "No chats yet"}
                  </p>
                  <h2>
                    {hasThreadSearch
                      ? isZh
                        ? "换个关键词再试试。"
                        : "Try a different keyword."
                      : showArchived
                        ? isZh
                          ? "当前没有归档聊天。"
                          : "There are no archived chats right now."
                        : isZh
                          ? "从这里发起第一条聊天。"
                          : "Start the first chat from here."}
                  </h2>
                  <p>
                    {hasThreadSearch
                      ? isZh
                        ? "可以继续按标题、项目名或仓库路径搜索。"
                        : "Try searching by title, project name, or repo path."
                      : isZh
                        ? "新聊天会直接连到共享 Codex 会话。"
                        : "A new chat connects directly to the shared Codex conversation."}
                  </p>
                </section>
              )}
            </section>
          </div>
        )}
      </CodexShell>

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
