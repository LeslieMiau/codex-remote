"use client";

import Link from "next/link";
import type { CodexOverviewResponse, CodexQueueEntry } from "@codex-remote/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { getCachedOverview, setCachedOverview } from "../lib/client-cache";
import { buildThreadPatchPath, buildThreadPath } from "../lib/codex-paths";
import { getCodexOverview } from "../lib/gateway-client";
import {
  getStoredInputFocusFilter,
  setStoredInputFocusFilter,
  type InputFocusFilter
} from "../lib/input-focus-storage";
import { setStoredThreadListRoute } from "../lib/thread-list-route-storage";
import {
  formatDateTime,
  localize,
  translateQueueKind,
  translateStatusText,
  useLocale
} from "../lib/locale";
import {
  describeNativeRequestActionLabel,
  describeNativeRequestAttentionLabel,
  describeNativeRequestQueueLabel,
  describeQueueInputPreview,
  isDesktopOrientedNativeRequest
} from "../lib/native-input-copy";
import { compareQueueEntriesForMobile } from "../lib/mobile-priority";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { DetailShell } from "./detail-shell";

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

function matchesInputFocusFilter(
  kind: CodexQueueEntry["native_request_kind"] | undefined,
  filter: InputFocusFilter
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "desktop") {
    return isDesktopOrientedNativeRequest(kind);
  }

  return kind === "user_input";
}

function matchesQueueEntryFilter(entry: CodexQueueEntry, filter: InputFocusFilter) {
  if (filter === "all") {
    return true;
  }

  return entry.kind === "input" && matchesInputFocusFilter(entry.native_request_kind, filter);
}

function describeInputFocusFilter(locale: "zh" | "en", filter: InputFocusFilter) {
  if (filter === "desktop") {
    return localize(locale, { zh: "回桌面", en: "Desktop" });
  }

  if (filter === "replyable") {
    return localize(locale, { zh: "手机可回", en: "Reply here" });
  }

  return localize(locale, { zh: "全部", en: "All" });
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
  const [inputFocusFilter, setInputFocusFilter] = useState<InputFocusFilter>(() =>
    getStoredInputFocusFilter()
  );
  const inFlightRef = useRef(false);

  useEffect(() => {
    setStoredThreadListRoute("/queue");
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
      if (interval) {
        window.clearInterval(interval);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    setStoredInputFocusFilter(inputFocusFilter);
  }, [inputFocusFilter]);

  const queue = overview?.queue ?? [];
  const actionableQueue = useMemo(
    () => [...queue].filter((entry) => entry.action_required).sort(compareQueueEntriesForMobile),
    [queue]
  );
  const filteredActionableQueue = useMemo(
    () => actionableQueue.filter((entry) => matchesQueueEntryFilter(entry, inputFocusFilter)),
    [actionableQueue, inputFocusFilter]
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
  const approvalCount = actionableQueue.filter((entry) => entry.kind === "approval").length;
  const patchCount = actionableQueue.filter((entry) => entry.kind === "patch").length;
  const failedCount = actionableQueue.filter((entry) => entry.kind === "failed").length;
  const leadEntry = filteredActionableQueue[0] ?? null;
  const subtitle =
    filteredActionableQueue.length > 0
      ? localize(locale, {
          zh: `${filteredActionableQueue.length} 项待处理`,
          en: `${filteredActionableQueue.length} items waiting`
        })
      : localize(locale, {
          zh: "现在没有需要你点开的事项。",
          en: "Nothing needs your attention right now."
        });

  function renderQueueRow(entry: CodexQueueEntry) {
    const isDesktopRecovery = isDesktopRecoveryInputEntry(entry);
    const thread = overview?.threads.find((candidate) => candidate.thread_id === entry.thread_id);

    return (
      <Link
        key={entry.entry_id}
        className={`codex-thread-row codex-thread-row--queue ${
          isDesktopRecovery ? "is-desktop-recovery" : ""
        }`}
        href={buildQueueHref(entry)}
        onClick={() => {
          setStoredThreadListRoute("/queue");
          setStoredLastActiveThread(entry.thread_id);
        }}
      >
        <div className="codex-thread-row__avatar">
          {getAvatarLabel(entry.title)}
        </div>
        <div className="codex-thread-row__content">
          <div className="codex-thread-row__head">
            <div className="codex-thread-row__title-wrap">
              <strong>{entry.title}</strong>
              <p>{describeQueuePreview(locale, entry)}</p>
            </div>
            <div className="codex-thread-row__aside">
              <span className="codex-thread-row__time">
                {formatDateTime(locale, entry.timestamp)}
              </span>
              <span className="codex-thread-row__badge">1</span>
            </div>
          </div>
          <div className="codex-thread-row__meta">
            <span className="status-dot">
              {entry.kind === "input"
                ? describeNativeRequestQueueLabel(
                    locale,
                    entry.native_request_kind ?? "user_input"
                  )
                : translateQueueKind(locale, entry.kind)}
            </span>
            {entry.kind === "input" ? (
              <span className={`status-dot ${isDesktopRecovery ? "tone-warning" : ""}`}>
                {describeNativeRequestAttentionLabel(
                  locale,
                  entry.native_request_kind ?? "user_input"
                )}
              </span>
            ) : null}
            <span className="status-dot">{translateStatusText(locale, entry.status)}</span>
            {thread ? <span className="status-dot">{getRepoTail(thread.repo_root)}</span> : null}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <DetailShell
      actions={
        <button
          className="chrome-button"
          disabled={isLoading || isRefreshing}
          onClick={() => {
            void getCodexOverview()
              .then((nextOverview) => {
                setOverview(nextOverview);
                setCachedOverview(nextOverview);
                setError(null);
              })
              .catch((loadError) =>
                setError(loadError instanceof Error ? loadError.message : String(loadError))
              );
          }}
          type="button"
        >
          {isRefreshing
            ? localize(locale, { zh: "同步中", en: "Syncing" })
            : localize(locale, { zh: "刷新", en: "Refresh" })}
        </button>
      }
      backHref="/projects"
      eyebrow={isZh ? "收件箱" : "Inbox"}
      subtitle={subtitle}
      title={isZh ? "待处理事项" : "Inbox"}
    >
      <div className="codex-page-stack codex-page-stack--detail">
        {error ? (
          <section
            aria-live="assertive"
            className="codex-status-strip codex-status-strip--stacked tone-danger"
            role="alert"
          >
            <div className="codex-status-strip__copy">
              <p className="section-label">{isZh ? "连接异常" : "Connection issue"}</p>
              <strong>{isZh ? "收件箱暂时没有同步成功" : "The inbox did not sync this time"}</strong>
              <p>{error}</p>
            </div>
          </section>
        ) : null}

        <section className="codex-home-hero codex-home-hero--compact">
          <div className="codex-home-hero__copy">
            <p className="section-label">{isZh ? "优先处理" : "Handle first"}</p>
            <strong>
              {leadEntry
                ? leadEntry.title
                : localize(locale, {
                    zh: "现在没有待处理事项。",
                    en: "There are no waiting items right now."
                  })}
            </strong>
            <p>
              {leadEntry
                ? describeQueuePreview(locale, leadEntry)
                : localize(locale, {
                    zh: "当 Codex 需要你批准、回复或审查时，新的事项会显示在这里。",
                    en: "When Codex needs a reply, approval, or review, new items will surface here."
                  })}
            </p>
          </div>
          <div className="codex-home-hero__pills">
            <span className="status-dot">
              {isZh
                ? `${replyableInputEntries.length} 条手机可回`
                : `${replyableInputEntries.length} reply here`}
            </span>
            <span className="status-dot tone-warning">
              {isZh
                ? `${desktopRecoveryInputEntries.length} 条回桌面`
                : `${desktopRecoveryInputEntries.length} desktop`}
            </span>
            <span className="status-dot">
              {isZh ? `${approvalCount} 个批准` : `${approvalCount} approvals`}
            </span>
            <span className="status-dot">
              {isZh ? `${patchCount} 个审查` : `${patchCount} reviews`}
            </span>
            <span className="status-dot">
              {isZh ? `${failedCount} 个失败` : `${failedCount} failed`}
            </span>
          </div>
          {leadEntry ? (
            <div className="codex-home-hero__actions">
              <Link
                className="primary-button"
                href={buildQueueHref(leadEntry)}
                onClick={() => {
                  setStoredThreadListRoute("/queue");
                  setStoredLastActiveThread(leadEntry.thread_id);
                }}
              >
                {leadEntry.kind === "input"
                  ? describeNativeRequestActionLabel(
                      locale,
                      leadEntry.native_request_kind ?? "user_input"
                    )
                  : localize(locale, { zh: "打开事项", en: "Open item" })}
              </Link>
            </div>
          ) : null}
        </section>

        <section className="codex-page-card codex-page-card--plain">
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
        </section>

        {isLoading && !overview ? (
          <div className="codex-page-stack">
            <div className="codex-thread-row codex-thread-row--placeholder" />
            <div className="codex-thread-row codex-thread-row--placeholder" />
            <div className="codex-thread-row codex-thread-row--placeholder" />
          </div>
        ) : filteredActionableQueue.length > 0 ? (
          <section className="codex-list-section">
            <div className="codex-list-section__head">
              <div>
                <p className="section-label">{isZh ? "收件箱列表" : "Inbox list"}</p>
                <h2>{isZh ? "按优先级排序" : "Sorted by urgency"}</h2>
              </div>
              <span className="state-pill">
                {isZh
                  ? `${filteredActionableQueue.length} 项`
                  : `${filteredActionableQueue.length} items`}
              </span>
            </div>
            <div className="codex-thread-list">
              {filteredActionableQueue.map((entry) => renderQueueRow(entry))}
            </div>
          </section>
        ) : (
          <section className="codex-empty-state">
            <p className="eyebrow">
              {inputFocusFilter === "all"
                ? isZh
                  ? "收件箱清空"
                  : "Inbox clear"
                : isZh
                  ? "当前筛选为空"
                  : "Nothing in this filter"}
            </p>
            <h2>
              {inputFocusFilter === "all"
                ? isZh
                  ? "现在没有需要你点开的待办消息。"
                  : "No messages need your attention right now."
                : isZh
                  ? "当前筛选下没有待办消息。"
                  : "No inbox items match the current filter."}
            </h2>
            <p>
              {inputFocusFilter === "all"
                ? isZh
                  ? "回到最近聊天，你仍然可以继续查看正在进行或刚完成的对话。"
                  : "You can still jump back into recent chats and keep following active conversations."
                : isZh
                  ? "切回“全部”可以重新查看其它待处理事项。"
                  : "Switch back to All to browse the rest of the waiting items again."}
            </p>
          </section>
        )}
      </div>
    </DetailShell>
  );
}
