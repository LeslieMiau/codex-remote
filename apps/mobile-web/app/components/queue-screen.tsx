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
  useLocale
} from "../lib/locale";
import {
  describeNativeRequestAttentionLabel,
  describeQueueInputPreview,
  isDesktopOrientedNativeRequest
} from "../lib/native-input-copy";
import { compareQueueEntriesForMobile } from "../lib/mobile-priority";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { getDisplayThreadTitle } from "../lib/chat-thread-presentation";
import { DetailShell } from "./detail-shell";
import styles from "./queue-screen.module.css";

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
        zh: "需要先处理这条批准请求。",
        en: "Handle this approval request first."
      });
    case "patch":
      return localize(locale, {
        zh: "有一份变更等你审查。",
        en: "A change is ready for review."
      });
    case "failed":
      return localize(locale, {
        zh: "这条聊天需要回来处理。",
        en: "This chat needs follow-up."
      });
    default:
      return localize(locale, {
        zh: "有新的事项需要查看。",
        en: "There is an item waiting here."
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
  const availableFilters = useMemo<InputFocusFilter[]>(
    () => [
      "all",
      ...(desktopRecoveryInputEntries.length > 0 ? (["desktop"] as const) : []),
      ...(replyableInputEntries.length > 0 ? (["replyable"] as const) : [])
    ],
    [desktopRecoveryInputEntries.length, replyableInputEntries.length]
  );
  const showFilterBar = availableFilters.length > 1;
  const summaryItems = [
    {
      key: "waiting",
      label: isZh
        ? `${filteredActionableQueue.length} 条待处理`
        : `${filteredActionableQueue.length} waiting`,
      tone: styles.summaryChipAccent,
      visible: filteredActionableQueue.length > 0
    },
    {
      key: "replyable",
      label: isZh
        ? `${replyableInputEntries.length} 条手机可回`
        : `${replyableInputEntries.length} reply here`,
      tone: "",
      visible: replyableInputEntries.length > 0
    },
    {
      key: "desktop",
      label: isZh
        ? `${desktopRecoveryInputEntries.length} 条回桌面`
        : `${desktopRecoveryInputEntries.length} desktop`,
      tone: styles.summaryChipWarning,
      visible: desktopRecoveryInputEntries.length > 0
    },
    {
      key: "approval",
      label: isZh ? `${approvalCount} 个批准` : `${approvalCount} approvals`,
      tone: "",
      visible: approvalCount > 0
    },
    {
      key: "patch",
      label: isZh ? `${patchCount} 个审查` : `${patchCount} reviews`,
      tone: "",
      visible: patchCount > 0
    },
    {
      key: "failed",
      label: isZh ? `${failedCount} 个失败` : `${failedCount} failed`,
      tone: "",
      visible: failedCount > 0
    }
  ].filter((item) => item.visible);
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

  useEffect(() => {
    if (availableFilters.includes(inputFocusFilter)) {
      return;
    }
    setInputFocusFilter("all");
  }, [availableFilters, inputFocusFilter]);

  function renderRefreshIcon() {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
      </svg>
    );
  }

  function renderQueueRow(entry: CodexQueueEntry) {
    const isDesktopRecovery = isDesktopRecoveryInputEntry(entry);
    const thread = overview?.threads.find((candidate) => candidate.thread_id === entry.thread_id);
    const title = thread ? getDisplayThreadTitle(locale, thread) : entry.title;
    const actionChip =
      entry.kind === "input"
        ? describeNativeRequestAttentionLabel(
            locale,
            entry.native_request_kind ?? "user_input"
          )
        : translateQueueKind(locale, entry.kind);

    return (
      <Link
        key={entry.entry_id}
        className={styles.row}
        data-thread-row={entry.entry_id}
        href={buildQueueHref(entry)}
        onClick={() => {
          setStoredThreadListRoute("/queue");
          setStoredLastActiveThread(entry.thread_id);
        }}
      >
        <div
          className={[
            styles.rowAvatar,
            isDesktopRecovery ? styles.rowAvatarWarning : ""
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {getAvatarLabel(title)}
        </div>
        <div className={styles.rowContent}>
          <div className={styles.rowHead}>
            <div className={styles.rowTitleWrap}>
              <strong className={styles.rowTitle}>{title}</strong>
              <p className={styles.rowPreview}>{describeQueuePreview(locale, entry)}</p>
            </div>
            <div className={styles.rowAside}>
              <span className={styles.rowTime}>{formatDateTime(locale, entry.timestamp)}</span>
              <span className={styles.rowBadge}>1</span>
            </div>
          </div>
          <div className={styles.rowMeta}>
            <span
              className={[
                styles.rowChip,
                entry.kind === "input"
                  ? isDesktopRecovery
                    ? styles.rowChipWarning
                    : styles.rowChipAccent
                  : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {actionChip}
            </span>
            {thread ? <span className={styles.rowChip}>{getRepoTail(thread.repo_root)}</span> : null}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <DetailShell
      actions={
        <button
          aria-label={
            isRefreshing
              ? localize(locale, { zh: "同步中", en: "Syncing" })
              : localize(locale, { zh: "刷新收件箱", en: "Refresh inbox" })
          }
          className={styles.iconButton}
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
          title={localize(locale, { zh: "刷新", en: "Refresh" })}
          type="button"
        >
          {renderRefreshIcon()}
        </button>
      }
      backHref="/projects"
      eyebrow={isZh ? "收件箱" : "Inbox"}
      subtitle={subtitle}
      title={isZh ? "待处理事项" : "Inbox"}
    >
      <div className={styles.page} data-queue-screen="compact-inbox">
        {error ? (
          <section
            aria-live="assertive"
            className={`${styles.notice} ${styles.noticeDanger}`}
            role="alert"
          >
            <div className={styles.noticeCopy}>
              <p className={styles.noticeLabel}>{isZh ? "连接异常" : "Connection issue"}</p>
              <strong>{isZh ? "收件箱暂时没有同步成功" : "The inbox did not sync this time"}</strong>
              <p>{error}</p>
            </div>
          </section>
        ) : null}

        {summaryItems.length > 0 ? (
          <div className={styles.summaryRow}>
            {summaryItems.map((item) => (
              <span
                className={[styles.summaryChip, item.tone].filter(Boolean).join(" ")}
                key={item.key}
              >
                {item.label}
              </span>
            ))}
          </div>
        ) : null}

        {showFilterBar ? (
          <div className={styles.filterBar}>
            {availableFilters.map((filter) => (
            <button
              key={filter}
              className={[
                styles.filterButton,
                inputFocusFilter === filter ? styles.filterButtonActive : ""
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setInputFocusFilter(filter)}
              type="button"
            >
              {describeInputFocusFilter(locale, filter)}
            </button>
            ))}
          </div>
        ) : null}

        {isLoading && !overview ? (
          <div aria-hidden="true" className={styles.loadingList}>
            <div className={styles.loadingRow} />
            <div className={styles.loadingRow} />
            <div className={styles.loadingRow} />
          </div>
        ) : filteredActionableQueue.length > 0 ? (
          <div className={styles.list}>{filteredActionableQueue.map((entry) => renderQueueRow(entry))}</div>
        ) : (
          <section className={styles.empty}>
            <p>
              {inputFocusFilter === "all" || !showFilterBar
                ? localize(locale, {
                    zh: "现在没有需要你点开的事项。",
                    en: "Nothing needs your attention right now."
                  })
                : localize(locale, {
                    zh: "当前筛选下没有事项。",
                    en: "No inbox items match this filter."
                  })}
            </p>
            <Link className={styles.emptyAction} href="/projects">
              {isZh ? "回到聊天" : "Back to chats"}
            </Link>
          </section>
        )}
      </div>
    </DetailShell>
  );
}
