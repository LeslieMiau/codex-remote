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
  compareThreadsForMobile,
  getMobileThreadPriority
} from "../lib/mobile-priority";
import {
  describeNativeRequestActionLabel,
  describeNativeRequestAttentionLabel,
  describeNativeRequestQueueLabel,
  describePendingInputSummary,
  describeQueueInputPreview,
  describeThreadPendingInputPreview,
  isDesktopOrientedNativeRequest
} from "../lib/native-input-copy";
import { filterThreadsForQuery } from "../lib/thread-search";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { CodexShell } from "./codex-shell";
import { NewThreadSheet } from "./new-thread-sheet";
import { SkeletonCard } from "./skeleton";

const POLL_INTERVAL_MS = 2_000;

type InputFocusFilter = "all" | "desktop" | "replyable";

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

function isDesktopRecoveryInputEntry(entry: CodexQueueEntry) {
  return entry.kind === "input" && isDesktopRecoveryInputKind(entry.native_request_kind);
}

function matchesInputFocusFilter(
  kind: CodexQueueEntry["native_request_kind"] | undefined,
  filter: InputFocusFilter
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "desktop") {
    return isDesktopRecoveryInputKind(kind);
  }

  return kind === "user_input";
}

function describeInputFocusFilter(
  locale: "zh" | "en",
  filter: InputFocusFilter
) {
  if (filter === "desktop") {
    return localize(locale, { zh: "回桌面", en: "Desktop" });
  }

  if (filter === "replyable") {
    return localize(locale, { zh: "手机可回", en: "Reply here" });
  }

  return localize(locale, { zh: "全部", en: "All" });
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
  const [showArchived, setShowArchived] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [inputFocusFilter, setInputFocusFilter] = useState<InputFocusFilter>("all");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
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
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [showArchived]);

  const runningCount =
    overview?.threads.filter((thread) => thread.state === "running").length ?? 0;
  const actionRequiredCount =
    overview?.queue.filter((entry) => entry.action_required).length ?? 0;
  const capabilities = overview?.capabilities;
  const hasThreadSearch = threadQuery.trim().length > 0;
  const filteredThreads = useMemo(
    () => filterThreadsForQuery(overview?.threads ?? [], threadQuery),
    [overview, threadQuery]
  );
  const latestThread = useMemo(
    () =>
      [...(overview?.threads ?? [])].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ??
      null,
    [overview]
  );
  const priorityEntries = useMemo(
    () =>
      [...(overview?.queue ?? [])]
        .filter((entry) => entry.action_required)
        .sort(compareQueueEntriesForMobile)
        .slice(0, 3),
    [overview]
  );
  const topPriorityEntry = priorityEntries[0] ?? null;
  const topPriorityInputKind =
    topPriorityEntry?.kind === "input"
      ? topPriorityEntry.native_request_kind ?? "user_input"
      : undefined;
  const pendingInputEntries = useMemo(
    () =>
      [...(overview?.queue ?? [])]
        .filter((entry) => entry.action_required && entry.kind === "input")
        .sort(compareQueueEntriesForMobile),
    [overview]
  );
  const leadInputEntry = pendingInputEntries[0] ?? null;
  const inputSummary = leadInputEntry
    ? describePendingInputSummary(
        locale,
        pendingInputEntries.length,
        leadInputEntry.native_request_kind ?? "user_input"
      )
    : null;
  const desktopRecoveryInputEntries = useMemo(
    () => pendingInputEntries.filter((entry) => isDesktopRecoveryInputEntry(entry)),
    [pendingInputEntries]
  );
  const replyableInputEntries = useMemo(
    () => pendingInputEntries.filter((entry) => !isDesktopRecoveryInputEntry(entry)),
    [pendingInputEntries]
  );
  const otherActionCount = actionRequiredCount - pendingInputEntries.length;
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
  const pendingInputKindsByThreadId = useMemo(() => {
    const kinds = new Map<string, CodexQueueEntry["native_request_kind"]>();

    for (const entry of pendingInputEntries) {
      if (!kinds.has(entry.thread_id)) {
        kinds.set(entry.thread_id, entry.native_request_kind);
      }
    }

    return kinds;
  }, [pendingInputEntries]);
  const filteredDesktopRecoveryInputEntries = useMemo(
    () =>
      inputFocusFilter === "replyable" ? [] : desktopRecoveryInputEntries,
    [desktopRecoveryInputEntries, inputFocusFilter]
  );
  const filteredReplyableInputEntries = useMemo(
    () =>
      inputFocusFilter === "desktop" ? [] : replyableInputEntries,
    [inputFocusFilter, replyableInputEntries]
  );
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

    for (const thread of filteredThreads) {
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
  }, [filteredThreads]);
  const priorityThreads = useMemo(
    () =>
      filteredThreads.filter(
        (thread) =>
          thread.pending_native_requests > 0 ||
          thread.pending_approvals > 0 ||
          thread.pending_patches > 0 ||
          thread.state === "failed" ||
          thread.state === "interrupted" ||
          thread.state === "running"
      ).sort(compareThreadsForMobile),
    [filteredThreads]
  );
  const filteredPriorityThreads = useMemo(
    () =>
      inputFocusFilter === "all"
        ? priorityThreads
        : priorityThreads.filter((thread) =>
            matchesInputFocusFilter(
              pendingInputKindsByThreadId.get(thread.thread_id),
              inputFocusFilter
            )
          ),
    [inputFocusFilter, pendingInputKindsByThreadId, priorityThreads]
  );
  const inboxOtherEntries = useMemo(
    () =>
      [...(overview?.queue ?? [])]
        .filter((entry) => entry.action_required && entry.kind !== "input")
        .sort(compareQueueEntriesForMobile)
        .slice(0, 3),
    [overview]
  );
  const filteredRepoGroups = useMemo(
    () =>
      inputFocusFilter === "all"
        ? repoGroups
        : repoGroups
            .map((group) => ({
              ...group,
              threads: group.threads.filter((thread) =>
                matchesInputFocusFilter(
                  pendingInputKindsByThreadId.get(thread.thread_id),
                  inputFocusFilter
                )
              )
            }))
            .filter((group) => group.threads.length > 0),
    [inputFocusFilter, pendingInputKindsByThreadId, repoGroups]
  );
  const visibleGroups = showAllProjects ? filteredRepoGroups : filteredRepoGroups.slice(0, 3);
  const hiddenGroupCount = Math.max(filteredRepoGroups.length - visibleGroups.length, 0);
  const matchingThreadCount = filteredThreads.length;

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
      router.push(buildThreadPath(created.thread.thread_id));
    } catch (createError) {
      setCreateError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreatingThread(false);
    }
  }

  function renderInboxEntry(entry: CodexQueueEntry) {
    return (
      <Link
        key={entry.entry_id}
        className={`codex-focus-item ${isDesktopRecoveryInputEntry(entry) ? "is-desktop-recovery" : ""}`}
        href={buildActionHref(entry)}
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
            </div>
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
            {capabilities?.shared_thread_create ? (
              <button
                className="chrome-button"
                disabled={isCreatingThread}
                onClick={() => setIsNewThreadOpen(true)}
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
        <div className="codex-page-stack">
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

          {leadDesktopRecoveryEntry && desktopRecoverySummary ? (
            <section className="codex-status-strip tone-warning">
              <div className="codex-status-strip__copy">
                <p className="section-label">{desktopRecoverySummary.eyebrow}</p>
                <strong>{desktopRecoverySummary.title}</strong>
                <p>{desktopRecoverySummary.body}</p>
              </div>
              <Link
                className="primary-button"
                href={buildThreadPath(leadDesktopRecoveryEntry.thread_id)}
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
                href={buildThreadPath(leadReplyableEntry.thread_id)}
                onClick={() => setStoredLastActiveThread(leadReplyableEntry.thread_id)}
              >
                {replyableSummary.cta}
              </Link>
            </section>
          ) : null}

          <section className="codex-page-card codex-page-card--primary">
            <div className="codex-page-card__copy">
              <p className="section-label">
                {topPriorityInputKind
                  ? describeNativeRequestAttentionLabel(locale, topPriorityInputKind)
                  : isZh
                    ? "继续聊天"
                    : "Jump back in"}
              </p>
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
                  ? topPriorityEntry.kind === "input"
                    ? describeQueuePreview(locale, topPriorityEntry)
                    : localize(locale, {
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
              {desktopRecoveryInputEntries.length > 0 ? (
                <span
                  className="status-dot tone-warning"
                >
                  {localize(locale, {
                    zh: `${desktopRecoveryInputEntries.length} 条回桌面`,
                    en: `${desktopRecoveryInputEntries.length} desktop`
                  })}
                </span>
              ) : null}
              {replyableInputEntries.length > 0 ? (
                <span className="status-dot">
                  {localize(locale, {
                    zh: `${replyableInputEntries.length} 条手机可回`,
                    en: `${replyableInputEntries.length} reply here`
                  })}
                </span>
              ) : null}
              {topPriorityInputKind && desktopRecoveryInputEntries.length === 0 && replyableInputEntries.length === 0 ? (
                <span
                  className={`status-dot ${
                    isDesktopRecoveryInputKind(topPriorityInputKind) ? "tone-warning" : ""
                  }`}
                >
                  {describeNativeRequestQueueLabel(locale, topPriorityInputKind)}
                </span>
              ) : null}
              {otherActionCount > 0 ? (
                <span className="status-dot">
                  {localize(locale, {
                    zh: `${otherActionCount} 条其它事项`,
                    en: `${otherActionCount} other`
                  })}
                </span>
              ) : null}
              <span className="status-dot">
                {isZh ? `${runningCount} 条进行中` : `${runningCount} active`}
              </span>
            </div>
            <div className="codex-page-card__footer">
              {topPriorityEntry ? (
                <Link
                  className="primary-button"
                  href={
                    topPriorityEntry.patch_id
                      ? buildThreadPatchPath(
                          topPriorityEntry.thread_id,
                          topPriorityEntry.patch_id
                        )
                      : buildThreadPath(topPriorityEntry.thread_id)
                  }
                  onClick={() => setStoredLastActiveThread(topPriorityEntry.thread_id)}
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

          <section className="codex-page-card threads-home__search-card">
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
                zh: "想找某条旧聊天时，直接搜标题、项目名或仓库路径就行。",
                en: "Search across chat titles, project names, and repo paths when you need an older thread."
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

          <section className="codex-page-card">
            <div className="codex-page-section__header">
              <div>
                <p className="section-label">
                  {localize(locale, { zh: "输入筛选", en: "Input focus" })}
                </p>
                <h2>
                  {localize(locale, {
                    zh: "按处理路径查看待办聊天",
                    en: "Sort chats by recovery path"
                  })}
                </h2>
              </div>
            </div>
            <div className="codex-inline-pills">
              {(["all", "desktop", "replyable"] as const).map((filter) => (
                <button
                  key={filter}
                  className={`chrome-button ${inputFocusFilter === filter ? "is-active" : ""}`}
                  onClick={() => setInputFocusFilter(filter)}
                  type="button"
                >
                  {describeInputFocusFilter(locale, filter)}
                </button>
              ))}
            </div>
            <p className="threads-home__search-note">
              {inputFocusFilter === "all"
                ? localize(locale, {
                    zh: "显示全部待办聊天；切到回桌面或手机可回，可以更快聚焦你现在能处理的那一类。",
                    en: "Showing all waiting chats. Switch to desktop or reply-here to focus on the kind you can handle next."
                  })
                : inputFocusFilter === "desktop"
                  ? localize(locale, {
                      zh: "当前只看建议回桌面继续的聊天；批准、审查和其它待办会先隐藏。",
                      en: "Only chats that usually continue on desktop are shown right now. Approvals, reviews, and other items are temporarily hidden."
                    })
                  : localize(locale, {
                      zh: "当前只看可以直接在手机回复的聊天。",
                      en: "Only chats you can finish from the phone are shown right now."
                    })}
            </p>
          </section>

          <section className="codex-page-section">
            <div className="codex-page-section__header">
              <div>
                <p className="section-label">{isZh ? "收件箱" : "Inbox"}</p>
                <h2>
                {inputFocusFilter === "desktop" ||
                (inputFocusFilter === "all" &&
                  leadInputEntry &&
                  isDesktopOrientedNativeRequest(leadInputEntry.native_request_kind))
                    ? localize(locale, { zh: "先打开这些", en: "Open these first" })
                    : localize(locale, { zh: "优先回复这些", en: "Reply to these first" })}
                </h2>
              </div>
              <Link className="chrome-button" href="/queue">
                {isZh ? "打开收件箱" : "Open inbox"}
              </Link>
            </div>

            {filteredDesktopRecoveryInputEntries.length > 0 ||
            filteredReplyableInputEntries.length > 0 ||
            (inputFocusFilter === "all" && inboxOtherEntries.length > 0) ? (
              <div className="codex-page-stack">
                {filteredDesktopRecoveryInputEntries.length > 0 ? (
                  <div className="codex-page-stack">
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
                      {filteredDesktopRecoveryInputEntries.slice(0, 2).map((entry) =>
                        renderInboxEntry(entry)
                      )}
                    </div>
                  </div>
                ) : null}

                {filteredReplyableInputEntries.length > 0 ? (
                  <div className="codex-page-stack">
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
                      {filteredReplyableInputEntries.slice(0, 2).map((entry) =>
                        renderInboxEntry(entry)
                      )}
                    </div>
                  </div>
                ) : null}

                {inputFocusFilter === "all" && inboxOtherEntries.length > 0 ? (
                  <div className="codex-page-stack">
                    <div className="codex-page-section__header">
                      <div>
                        <p className="section-label">{isZh ? "其它事项" : "Other items"}</p>
                        <h2>{isZh ? "这些也要尽快处理" : "These still need attention"}</h2>
                      </div>
                    </div>
                    <div className="codex-inbox-focus">
                      {inboxOtherEntries.map((entry) => renderInboxEntry(entry))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <section className="codex-empty-state">
                <p className="eyebrow">
                  {inputFocusFilter === "all"
                    ? isZh
                      ? "消息清空"
                      : "All caught up"
                    : isZh
                      ? "当前筛选为空"
                      : "Nothing in this filter"}
                </p>
                <h2>{isZh ? "现在没有急着要回的消息。" : "No urgent messages waiting."}</h2>
                <p>
                  {inputFocusFilter === "all"
                    ? isZh
                      ? "你仍然可以回到最近对话继续聊，或者从这里发起一条新聊天。"
                      : "You can still jump back into recent chats or start a fresh one from here."
                    : isZh
                      ? "切回“全部”可以查看其它类型的待办聊天。"
                      : "Switch back to All to see the other waiting chats again."}
                </p>
              </section>
            )}
          </section>

          {filteredPriorityThreads.length > 0 ? (
            <section className="codex-page-section">
              <div className="codex-page-section__header">
                <div>
                  <p className="section-label">{isZh ? "继续这些聊天" : "Pick up here"}</p>
                  <h2>
                    {inputFocusFilter === "desktop"
                      ? localize(locale, {
                          zh: "这些对话通常要回桌面继续",
                          en: "These chats usually continue on desktop"
                        })
                      : inputFocusFilter === "replyable"
                        ? localize(locale, {
                            zh: "这些对话可以直接在手机处理",
                            en: "These chats can be handled from the phone"
                          })
                        : localize(locale, {
                            zh: "这些对话还在等你继续",
                            en: "Chats waiting on you"
                          })}
                  </h2>
                </div>
              </div>
              <div className="codex-list-stack">
                {filteredPriorityThreads.slice(0, 4).map((thread) => (
                  (() => {
                    const pendingInputKind = pendingInputKindsByThreadId.get(thread.thread_id);
                    const isDesktopRecovery = isDesktopRecoveryInputKind(pendingInputKind);

                    return (
                  <Link
                    key={thread.thread_id}
                    className={`codex-thread-list-item ${
                      isDesktopRecovery
                        ? "is-desktop-recovery"
                        : ""
                    } ${
                      thread.pending_approvals > 0 ||
                      thread.pending_patches > 0 ||
                      thread.pending_native_requests > 0 ||
                      thread.state === "failed" ||
                      thread.state === "interrupted"
                        ? "is-emphasis"
                        : thread.state === "running"
                          ? "is-live"
                          : ""
                    }`}
                    href={buildThreadPath(thread.thread_id)}
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
                              {describeThreadPreview(
                                locale,
                                thread,
                                pendingInputKind
                              )}
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
                          {pendingInputKind ? (
                            <span
                              className={`status-dot ${
                                isDesktopRecovery ? "tone-warning" : ""
                              }`}
                            >
                              {describeNativeRequestAttentionLabel(locale, pendingInputKind)}
                            </span>
                          ) : null}
                          <span className="status-dot">{getRepoTail(thread.repo_root)}</span>
                          <span className="status-dot">
                            {translateThreadState(locale, thread.state)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                    );
                  })()
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

            {visibleGroups.length > 0 ? (
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
                        (() => {
                          const pendingInputKind = pendingInputKindsByThreadId.get(
                            thread.thread_id
                          );
                          const isDesktopRecovery =
                            isDesktopRecoveryInputKind(pendingInputKind);

                          return (
                        <Link
                          key={thread.thread_id}
                          className={`codex-thread-list-item ${
                            isDesktopRecovery
                              ? "is-desktop-recovery"
                              : ""
                          } ${
                            thread.pending_approvals > 0 ||
                            thread.pending_patches > 0 ||
                            thread.pending_native_requests > 0 ||
                            thread.state === "failed" ||
                            thread.state === "interrupted"
                              ? "is-emphasis"
                              : thread.state === "running"
                                ? "is-live"
                                : ""
                          }`}
                          href={buildThreadPath(thread.thread_id)}
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
                                    {describeThreadPreview(
                                      locale,
                                      thread,
                                      pendingInputKind
                                    )}
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
                                {pendingInputKind ? (
                                  <span
                                    className={`status-dot ${
                                      isDesktopRecovery ? "tone-warning" : ""
                                    }`}
                                  >
                                    {describeNativeRequestAttentionLabel(
                                      locale,
                                      pendingInputKind
                                    )}
                                  </span>
                                ) : null}
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
                          );
                        })()
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
            ) : (
              <section className="codex-empty-state">
                <p className="eyebrow">
                  {inputFocusFilter === "all"
                    ? isZh
                      ? "没有匹配"
                      : "No matches"
                    : isZh
                      ? "当前筛选没有结果"
                      : "No chats in this filter"}
                </p>
                <h2>
                  {inputFocusFilter === "all"
                    ? isZh
                      ? "这次搜索还没有找到聊天。"
                      : "This search does not match any chats yet."
                    : isZh
                      ? "当前筛选下没有聊天。"
                      : "No chats match the current filter."}
                </h2>
                <p>
                  {inputFocusFilter === "all"
                    ? isZh
                      ? "试试换成项目名、仓库路径，或者清空搜索看看最近同步过的全部对话。"
                      : "Try a project name, part of the repo path, or clear the search to browse every synced chat again."
                    : isZh
                      ? "切回“全部”或换一个输入筛选，再看看其它等待中的聊天。"
                      : "Switch back to All or try a different input filter to browse the other waiting chats."}
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
