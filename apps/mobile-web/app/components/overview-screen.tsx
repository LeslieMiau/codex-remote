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
  formatDateTime,
  localize,
  translateQueueKind,
  translateThreadState,
  useLocale
} from "../lib/locale";
import {
  compareQueueEntriesForMobile,
  compareThreadsForMobile,
  getMobileThreadPriority
} from "../lib/mobile-priority";
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

function describeThreadPreview(locale: "zh" | "en", thread: CodexThread) {
  if (thread.pending_native_requests > 0) {
    return localize(locale, {
      zh: "Codex 正等你回复，回一句就能继续往下跑。",
      en: "Codex is waiting for your reply before this chat can keep going."
    });
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
      return localize(locale, {
        zh: `需要你回一条消息。${detail}`,
        en: `Needs a reply from you. ${detail}`
      });
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
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
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
          setCachedCapabilities(nextOverview.capabilities);
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
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const runningCount =
    overview?.threads.filter((thread) => thread.state === "running").length ?? 0;
  const actionRequiredCount =
    overview?.queue.filter((entry) => entry.action_required).length ?? 0;
  const capabilities = overview?.capabilities;
  const latestThread = useMemo(
    () =>
      [...(overview?.threads ?? [])].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ??
      null,
    [overview]
  );
  const focusEntries = useMemo(
    () =>
      [...(overview?.queue ?? [])]
        .filter((entry) => entry.action_required)
        .sort(compareQueueEntriesForMobile)
        .slice(0, 3),
    [overview]
  );
  const topPriorityEntry = focusEntries[0] ?? null;
  const repoGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        projectId: string;
        label: string;
        repoRoot: string;
        threads: NonNullable<CodexOverviewResponse["threads"]>;
      }
    >();

    for (const thread of overview?.threads ?? []) {
      const current =
        groups.get(thread.project_id) ?? {
          projectId: thread.project_id,
          label: thread.project_label,
          repoRoot: thread.repo_root,
          threads: []
        };
      current.threads.push(thread);
      groups.set(thread.project_id, current);
    }

    for (const group of groups.values()) {
      group.threads.sort(compareThreadsForMobile);
    }

    const groupPriority = (group: { threads: NonNullable<CodexOverviewResponse["threads"]> }) =>
      group.threads.reduce((score, thread) => Math.max(score, getMobileThreadPriority(thread)), 0);

    return [...groups.values()].sort((left, right) => {
      const priorityDelta = groupPriority(right) - groupPriority(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return right.threads[0]?.updated_at.localeCompare(left.threads[0]?.updated_at ?? "") ?? 0;
    });
  }, [overview]);
  const priorityThreads = useMemo(
    () =>
      (overview?.threads ?? []).filter(
        (thread) =>
          thread.pending_approvals > 0 ||
          thread.pending_patches > 0 ||
          thread.state === "failed" ||
          thread.state === "interrupted" ||
          thread.state === "running"
      ).sort(compareThreadsForMobile),
    [overview]
  );
  const visibleGroups = showAllProjects ? repoGroups : repoGroups.slice(0, 3);
  const hiddenGroupCount = Math.max(repoGroups.length - visibleGroups.length, 0);

  function toggleProject(projectId: string) {
    setExpandedProjects((current) => ({
      ...current,
      [projectId]: !current[projectId]
    }));
  }

  async function handleCreateThread(input: { prompt: string; repoRoot: string }) {
    setIsCreatingThread(true);
    setCreateError(null);

    try {
      const created = await createSharedThread({
        repoRoot: input.repoRoot,
        prompt: input.prompt
      });
      setStoredLastActiveThread(created.thread.thread_id);
      setIsNewThreadOpen(false);
      router.push(`/threads/${created.thread.thread_id}`);
    } catch (createError) {
      setCreateError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreatingThread(false);
    }
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
            {capabilities?.shared_thread_create ? (
              <button
                className="chrome-button"
                disabled={isCreatingThread}
                onClick={() => setIsNewThreadOpen(true)}
              >
                {isZh ? "新聊天" : "New chat"}
              </button>
            ) : null}
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
        <div className="codex-page-stack">
          {error ? (
            <section aria-live="assertive" className="codex-status-strip codex-status-strip--stacked tone-danger" role="alert">
              <div className="codex-status-strip__copy">
                <p className="section-label">{isZh ? "连接异常" : "Connection issue"}</p>
                <strong>{isZh ? "最近对话暂时没有同步成功" : "Recent chats did not sync this time"}</strong>
                <p>{error}</p>
              </div>
            </section>
          ) : null}

          <section className="codex-page-card codex-page-card--primary">
            <div className="codex-page-card__copy">
              <p className="section-label">{isZh ? "继续聊天" : "Jump back in"}</p>
              <strong>
                {isLoading && !overview
                  ? localize(locale, {
                      zh: "正在同步最近对话",
                      en: "Syncing recent chats"
                    })
                  : topPriorityEntry
                    ? topPriorityEntry.title
                  : latestThread
                  ? latestThread.title
                  : localize(locale, {
                      zh: "从手机发起一条新聊天",
                      en: "Start a new chat from the phone"
                    })}
              </strong>
              <p>
                {topPriorityEntry
                  ? localize(locale, {
                      zh: `${translateQueueKind(locale, topPriorityEntry.kind)}需要优先处理。${topPriorityEntry.summary ?? topPriorityEntry.status}`,
                      en: `${translateQueueKind(locale, topPriorityEntry.kind)} needs attention first. ${topPriorityEntry.summary ?? topPriorityEntry.status}`
                    })
                : latestThread
                  ? localize(locale, {
                      zh: `最近活跃于 ${formatDateTime(locale, latestThread.updated_at)}，点进去就能接着聊。`,
                      en: `Active ${formatDateTime(locale, latestThread.updated_at)}. Open it and keep the conversation going.`
                    })
                  : localize(locale, {
                      zh: "发起聊天后，第一条消息会直接进入共享 Codex 会话。",
                      en: "When you start a chat, the first message goes straight into the shared Codex conversation."
                    })}
              </p>
            </div>
            <div className="codex-page-card__meta">
              <span className="status-dot">
                {isZh ? `${runningCount} 条进行中` : `${runningCount} active`}
              </span>
              <span className="status-dot">
                {isZh ? `${actionRequiredCount} 条待回` : `${actionRequiredCount} waiting`}
              </span>
            </div>
            <div className="codex-page-card__footer">
              {topPriorityEntry ? (
                <Link
                  className="primary-button"
                  href={
                    topPriorityEntry.patch_id
                      ? `/threads/${topPriorityEntry.thread_id}/patches/${topPriorityEntry.patch_id}`
                      : `/threads/${topPriorityEntry.thread_id}`
                  }
                  onClick={() => setStoredLastActiveThread(topPriorityEntry.thread_id)}
                >
                  {isZh ? "马上处理" : "Open now"}
                </Link>
              ) : latestThread ? (
                <Link
                  className="primary-button"
                  href={`/threads/${latestThread.thread_id}`}
                  onClick={() => setStoredLastActiveThread(latestThread.thread_id)}
                >
                  {isZh ? "继续聊天" : "Continue chat"}
                </Link>
              ) : null}
              {capabilities?.shared_thread_create ? (
                <button
                  className={topPriorityEntry || latestThread ? "secondary-button" : "primary-button"}
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
          </section>

          <section className="codex-page-section">
            <div className="codex-page-section__header">
              <div>
                <p className="section-label">{isZh ? "收件箱" : "Inbox"}</p>
                <h2>{isZh ? "优先回复这些" : "Reply to these first"}</h2>
              </div>
              <Link className="chrome-button" href="/queue">
                {isZh ? "打开收件箱" : "Open inbox"}
              </Link>
            </div>

            {focusEntries.length > 0 ? (
              <div className="codex-inbox-focus">
                {focusEntries.map((entry) => (
                  <Link
                    key={entry.entry_id}
                    className="codex-focus-item"
                    href={
                      entry.patch_id
                        ? `/threads/${entry.thread_id}/patches/${entry.patch_id}`
                        : `/threads/${entry.thread_id}`
                    }
                    onClick={() => setStoredLastActiveThread(entry.thread_id)}
                  >
                    <div className="codex-chat-row">
                      <div className="codex-chat-avatar">
                        {getAvatarLabel(entry.title)}
                      </div>
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
                          <span className="cue-pill">{translateQueueKind(locale, entry.kind)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <section className="codex-empty-state">
                <p className="eyebrow">{isZh ? "消息清空" : "All caught up"}</p>
                <h2>{isZh ? "现在没有急着要回的消息。" : "No urgent messages waiting."}</h2>
                <p>
                  {isZh
                    ? "你仍然可以回到最近对话继续聊，或者从这里发起一条新聊天。"
                    : "You can still jump back into recent chats or start a fresh one from here."}
                </p>
              </section>
            )}
          </section>

          {priorityThreads.length > 0 ? (
            <section className="codex-page-section">
              <div className="codex-page-section__header">
                <div>
                  <p className="section-label">{isZh ? "继续这些聊天" : "Pick up here"}</p>
                  <h2>{isZh ? "这些对话还在等你继续" : "Chats waiting on you"}</h2>
                </div>
              </div>
              <div className="codex-list-stack">
                {priorityThreads.slice(0, 4).map((thread) => (
                  <Link
                    key={thread.thread_id}
                    className={`codex-thread-list-item ${
                      thread.pending_approvals > 0 ||
                      thread.pending_patches > 0 ||
                      thread.state === "failed" ||
                      thread.state === "interrupted"
                        ? "is-emphasis"
                        : thread.state === "running"
                          ? "is-live"
                          : ""
                    }`}
                    href={`/threads/${thread.thread_id}`}
                    onClick={() => setStoredLastActiveThread(thread.thread_id)}
                  >
                    <div className="codex-chat-row">
                      <div className="codex-chat-avatar">
                        {getAvatarLabel(thread.project_label)}
                      </div>
                      <div className="codex-thread-list-item__body">
                        <div className="codex-thread-list-item__head">
                          <div>
                            <strong>{thread.title}</strong>
                            <p className="codex-thread-list-item__preview">
                              {describeThreadPreview(locale, thread)}
                            </p>
                          </div>
                          <div className="codex-thread-list-item__aside">
                            <span className="codex-thread-list-item__time">
                              {formatDateTime(locale, thread.updated_at)}
                            </span>
                            {getThreadBadgeLabel(locale, thread) ? (
                              <span className="codex-chat-count">
                                {getThreadBadgeLabel(locale, thread)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="codex-thread-list-item__meta">
                          <span className="cue-pill">{thread.project_label}</span>
                          <span className="status-dot">{getRepoTail(thread.repo_root)}</span>
                          <span className="status-dot">
                            {translateThreadState(locale, thread.state)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="codex-page-section">
            <div className="codex-page-section__header">
              <div>
                <p className="section-label">{isZh ? "聊天文件夹" : "Folders"}</p>
                <h2>{isZh ? "按工作区整理聊天" : "Browse chats by workspace"}</h2>
              </div>
              {hiddenGroupCount > 0 ? (
                <button
                  className="chrome-button"
                  onClick={() => setShowAllProjects((current) => !current)}
                  type="button"
                >
                  {showAllProjects
                    ? localize(locale, { zh: "收起", en: "Show fewer" })
                    : localize(locale, {
                        zh: `再展开 ${hiddenGroupCount} 个`,
                        en: `${hiddenGroupCount} more`
                      })}
                </button>
              ) : null}
            </div>

            <div className="codex-list-stack">
              {visibleGroups.map((group) => {
                const isExpanded = expandedProjects[group.projectId] ?? false;
                const visibleThreads = isExpanded ? group.threads : group.threads.slice(0, 2);
                const hiddenThreadCount = Math.max(group.threads.length - visibleThreads.length, 0);

                return (
                  <section key={group.projectId} className="codex-thread-list-card">
                    <div className="codex-page-section__header">
                      <div>
                        <p className="workspace-project">{group.label}</p>
                        <h3>{group.repoRoot}</h3>
                      </div>
                      <div className="codex-inline-pills">
                        <span className="state-pill">{group.threads.length}</span>
                        <span className="status-dot">
                          {isZh
                            ? `${group.threads.filter((thread) => thread.state === "running").length} 个运行中`
                            : `${group.threads.filter((thread) => thread.state === "running").length} running`}
                        </span>
                      </div>
                    </div>

                    <div className="codex-list-stack">
                      {visibleThreads.map((thread) => (
                        <Link
                          key={thread.thread_id}
                          className={`codex-thread-list-item ${
                            thread.pending_approvals > 0 ||
                            thread.pending_patches > 0 ||
                            thread.state === "failed" ||
                            thread.state === "interrupted"
                              ? "is-emphasis"
                              : thread.state === "running"
                                ? "is-live"
                                : ""
                          }`}
                          href={`/threads/${thread.thread_id}`}
                          onClick={() => setStoredLastActiveThread(thread.thread_id)}
                        >
                          <div className="codex-chat-row">
                            <div className="codex-chat-avatar">
                              {getAvatarLabel(thread.project_label)}
                            </div>
                            <div className="codex-thread-list-item__body">
                              <div className="codex-thread-list-item__head">
                                <div>
                                  <strong>{thread.title}</strong>
                                  <p className="codex-thread-list-item__preview">
                                    {describeThreadPreview(locale, thread)}
                                  </p>
                                </div>
                                <div className="codex-thread-list-item__aside">
                                  <span className="codex-thread-list-item__time">
                                    {formatDateTime(locale, thread.updated_at)}
                                  </span>
                                  {getThreadBadgeLabel(locale, thread) ? (
                                    <span className="codex-chat-count">
                                      {getThreadBadgeLabel(locale, thread)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="codex-thread-list-item__meta">
                                <span className="cue-pill">{thread.project_label}</span>
                                <span className="status-dot">
                                  {getRepoTail(thread.repo_root)}
                                </span>
                                <span className="status-dot">
                                  {translateThreadState(locale, thread.state)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>

                    {hiddenThreadCount > 0 ? (
                      <div className="codex-page-card__footer">
                        <button
                          className="chrome-button"
                          onClick={() => toggleProject(group.projectId)}
                          type="button"
                        >
                          {isExpanded
                            ? localize(locale, { zh: "收起对话", en: "Show fewer chats" })
                            : localize(locale, {
                                zh: `再展开 ${hiddenThreadCount} 条聊天`,
                                en: `${hiddenThreadCount} more chats`
                              })}
                        </button>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </section>
        </div>
        )}
      </CodexShell>

      <NewThreadSheet
        disableDismiss={isCreatingThread}
        error={createError}
        isSubmitting={isCreatingThread}
        open={isNewThreadOpen}
        projects={overview?.projects ?? []}
        onClose={() => {
          if (!isCreatingThread) {
            setCreateError(null);
            setIsNewThreadOpen(false);
          }
        }}
        onSubmit={handleCreateThread}
      />
    </>
  );
}
