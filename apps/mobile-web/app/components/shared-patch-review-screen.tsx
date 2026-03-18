"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexTimelineResponse } from "@codex-remote/protocol";

import { decidePatch, getCodexTimeline } from "../lib/gateway-client";
import { writeThreadFlashMessage } from "../lib/flash-message";
import {
  formatDateTime,
  localize,
  useLocale
} from "../lib/locale";
import { CodexShell } from "./codex-shell";
import { MobileSheet } from "./mobile-sheet";

interface SharedPatchReviewScreenProps {
  patchId: string;
  threadId: string;
}

const POLL_INTERVAL_MS = 2_000;

function translatePatchStatus(locale: "zh" | "en", status: string) {
  if (locale === "zh") {
    switch (status) {
      case "generated":
      case "reviewed":
        return "待查看";
      case "applied":
        return "已应用";
      case "discarded":
        return "已丢弃";
      default:
        return status;
    }
  }

  switch (status) {
    case "generated":
    case "reviewed":
      return "Ready to review";
    case "applied":
      return "Applied";
    case "discarded":
      return "Discarded";
    default:
      return status;
  }
}

export function SharedPatchReviewScreen({
  patchId,
  threadId
}: SharedPatchReviewScreenProps) {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const router = useRouter();
  const [timeline, setTimeline] = useState<CodexTimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [pendingAction, setPendingAction] = useState<"discard" | "rollback" | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      try {
        const nextTimeline = await getCodexTimeline(threadId);
        if (!cancelled) {
          setTimeline(nextTimeline);
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
        }
      }
    };

    void load();
    const interval = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [threadId]);

  const patch = useMemo(
    () => timeline?.patches.find((candidate) => candidate.patch_id === patchId) ?? null,
    [patchId, timeline]
  );
  const patchFileSummaryByPath = useMemo(
    () => new Map((patch?.files ?? []).map((file) => [file.path, file])),
    [patch]
  );
  const totalAddedLines = useMemo(
    () => (patch?.files ?? []).reduce((sum, file) => sum + file.added_lines, 0),
    [patch]
  );
  const totalRemovedLines = useMemo(
    () => (patch?.files ?? []).reduce((sum, file) => sum + file.removed_lines, 0),
    [patch]
  );

  function getSuccessMessage(action: "apply" | "discard" | "rollback") {
    switch (action) {
      case "apply":
        return localize(locale, {
          zh: "这次变更已经应用到当前聊天。",
          en: "This change was applied to the current chat."
        });
      case "rollback":
        return localize(locale, {
          zh: "这次变更已经回滚。",
          en: "This change was rolled back."
        });
      default:
        return localize(locale, {
          zh: "这次变更已跳过。",
          en: "This change was skipped."
        });
    }
  }

  async function handleAction(action: "apply" | "discard" | "rollback") {
    if (action === "discard" || action === "rollback") {
      setPendingAction(action);
      return;
    }

    setIsMutating(true);
    setError(null);

    try {
      await decidePatch(patchId, action);
      writeThreadFlashMessage({
        kind: "thread-toast",
        message: getSuccessMessage(action),
        threadId
      });
      router.replace(`/threads/${threadId}`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      setIsMutating(false);
    }
  }

  async function handleConfirmedAction() {
    if (!pendingAction) {
      return;
    }

    const action = pendingAction;
    setIsMutating(true);
    setError(null);

    try {
      await decidePatch(patchId, action);
      writeThreadFlashMessage({
        kind: "thread-toast",
        message: getSuccessMessage(action),
        threadId
      });
      router.replace(`/threads/${threadId}`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      setIsMutating(false);
    }
  }

  if (isLoading) {
    return (
      <main className="launch-shell">
        <section className="launch-card">
          <p className="eyebrow">{isZh ? "变更" : "Change"}</p>
          <h1 className="launch-title">
            {isZh ? "正在加载这次变更。" : "Loading this change."}
          </h1>
        </section>
      </main>
    );
  }

  if (!timeline || !patch) {
    return (
      <CodexShell
        backHref={`/threads/${threadId}`}
        eyebrow={isZh ? "变更" : "Change"}
        subtitle={
          isZh
            ? "这次变更已经不在当前聊天时间线里了。"
            : "This change is no longer available from the current chat timeline."
        }
        title={isZh ? "变更不可用" : "Change unavailable"}
      >
        {error ? (
          <section aria-live="assertive" className="codex-status-strip codex-status-strip--stacked tone-danger" role="alert">
            <div className="codex-status-strip__copy">
              <p className="section-label">{isZh ? "查看异常" : "Review issue"}</p>
              <strong>{isZh ? "当前无法读取这次变更" : "This change cannot be read right now"}</strong>
              <p>{error}</p>
            </div>
          </section>
        ) : null}
        <section className="codex-empty-state">
          <h2>{isZh ? "没有找到这次变更。" : "Change not found."}</h2>
          <p>
            {isZh
              ? "聊天还在，但这次变更已经不再处于待查看状态。"
              : "The chat is still available, but this change is no longer pending review."}
          </p>
          <Link className="primary-button" href={`/threads/${threadId}`}>
            {isZh ? "返回聊天" : "Back to chat"}
          </Link>
        </section>
      </CodexShell>
    );
  }

  return (
    <CodexShell
      eyebrow={isZh ? "变更" : "Change"}
      subtitle={timeline.thread.repo_root}
      title={timeline.thread.title}
      actions={
        <div className="codex-header-cues">
          <span className="state-pill">{translatePatchStatus(locale, patch.status)}</span>
          <Link className="chrome-button" href={`/threads/${threadId}`}>
            {isZh ? "返回聊天" : "Back to chat"}
          </Link>
        </div>
      }
    >
      <div className="codex-patch-stack">
        {error ? (
          <section aria-live="assertive" className="codex-status-strip codex-status-strip--stacked tone-danger" role="alert">
            <div className="codex-status-strip__copy">
              <p className="section-label">{isZh ? "查看异常" : "Review issue"}</p>
              <strong>{isZh ? "这次变更暂时没有刷新成功" : "This change did not refresh this time"}</strong>
              <p>{error}</p>
            </div>
          </section>
        ) : patch.rollback_available ? (
          <section className="codex-status-strip tone-warning">
            <div className="codex-status-strip__copy">
              <p className="section-label">{isZh ? "可以撤回" : "Rollback available"}</p>
              <strong>{isZh ? "这次变更已经应用过，仍然可以回滚" : "This change was already applied and can still be rolled back"}</strong>
              <p>
                {isZh
                  ? "如果确认这次改动不该保留，可以直接在手机上回滚。"
                  : "If this change should be undone, you can roll it back directly from mobile."}
              </p>
            </div>
            <span className="state-pill">{isZh ? "谨慎操作" : "Use carefully"}</span>
          </section>
        ) : patch.changes.length === 0 ? (
          <section className="codex-status-strip tone-warning">
            <div className="codex-status-strip__copy">
              <p className="section-label">{isZh ? "预览受限" : "Preview limited"}</p>
              <strong>{isZh ? "当前只拿到了文件摘要" : "Only a file summary is available right now"}</strong>
              <p>
                {isZh
                  ? "你可以先根据受影响文件做判断，想看完整 diff 再回桌面端深入检查。"
                  : "You can still judge the scope from the affected files, then fall back to desktop for a full diff if needed."}
              </p>
            </div>
          </section>
        ) : null}

        <section className="codex-patch-summary codex-page-card--primary">
          <div className="codex-page-card__copy">
            <p className="section-label">{isZh ? "变更摘要" : "Change summary"}</p>
            <strong>{patch.summary}</strong>
            <p>
              {patch.test_summary ??
                localize(locale, {
                  zh: "这次变更没有附带额外的测试摘要。",
                  en: "No extra test summary was reported for this change."
                })}
            </p>
          </div>
          <div className="codex-patch-summary__stats">
            <span className="status-dot">
              {isZh ? `${patch.files.length} 个文件` : `${patch.files.length} files`}
            </span>
            <span className="status-dot">
              {isZh ? `${patch.changes.length} 个差异块` : `${patch.changes.length} diffs`}
            </span>
            <span className="status-dot">+{totalAddedLines}</span>
            <span className="status-dot">-{totalRemovedLines}</span>
            <span className="status-dot">
              {localize(locale, { zh: "更新于", en: "Updated" })} {formatDateTime(locale, patch.updated_at)}
            </span>
          </div>
          <div className="feed-file-list codex-file-chip-list">
            {patch.files.map((file) => (
              <span key={file.path} className="codex-file-chip">
                <strong>{file.path}</strong>
                <span>
                  +{file.added_lines} / -{file.removed_lines}
                </span>
              </span>
            ))}
          </div>
        </section>

        <section className="codex-page-section">
          <div className="codex-page-section__header">
            <div>
              <p className="section-label">{isZh ? "变更文件" : "Changed files"}</p>
              <h2>{isZh ? "按文件逐个查看" : "Browse file by file"}</h2>
            </div>
          </div>

          <div className="codex-patch-stack">
            {patch.changes.length > 0 ? (
              patch.changes.map((change, index) => (
                <details key={change.path} className="codex-patch-file" open={index === 0}>
                  <summary>
                    <div>
                      <p className="workspace-project">{isZh ? "变更" : "Change"}</p>
                      <strong>{change.path}</strong>
                    </div>
                    <span className="state-pill">
                      {change.unified_diff
                        ? localize(locale, { zh: "统一 diff", en: "Unified diff" })
                        : localize(locale, { zh: "内容对比", en: "Content compare" })}
                    </span>
                  </summary>

                  <div className="codex-patch-file__meta">
                    {patchFileSummaryByPath.get(change.path) ? (
                      <>
                        <span className="status-dot">
                          +{patchFileSummaryByPath.get(change.path)?.added_lines ?? 0}
                        </span>
                        <span className="status-dot">
                          -{patchFileSummaryByPath.get(change.path)?.removed_lines ?? 0}
                        </span>
                      </>
                    ) : null}
                    <span className="status-dot">
                      {change.unified_diff
                        ? localize(locale, { zh: "可直接查看 diff", en: "Direct diff available" })
                        : localize(locale, { zh: "前后内容对比", en: "Before/after compare" })}
                    </span>
                  </div>

                  <div className="codex-patch-file__body">
                    {change.unified_diff ? (
                      <pre className="codex-mono-block">{change.unified_diff}</pre>
                    ) : (
                      <div className="review-fallback">
                        {change.before_content !== null ? (
                          <section className="review-block">
                            <span className="section-label">{isZh ? "变更前" : "Before"}</span>
                            <pre className="codex-mono-block">{change.before_content}</pre>
                          </section>
                        ) : null}
                        {change.after_content !== null ? (
                          <section className="review-block">
                            <span className="section-label">{isZh ? "变更后" : "After"}</span>
                            <pre className="codex-mono-block">{change.after_content}</pre>
                          </section>
                        ) : null}
                      </div>
                    )}
                  </div>
                </details>
              ))
            ) : (
              <article className="codex-patch-file">
                <div>
                  <p className="workspace-project">{isZh ? "文件" : "Files"}</p>
                  <strong>{isZh ? "没有更多变更内容" : "No diff payload available"}</strong>
                </div>
                <div className="feed-file-list codex-file-chip-list">
                  {patch.files.map((file) => (
                    <span key={file.path} className="codex-file-chip">
                      <strong>{file.path}</strong>
                      <span>
                        +{file.added_lines} / -{file.removed_lines}
                      </span>
                    </span>
                  ))}
                </div>
              </article>
            )}
          </div>
        </section>
      </div>

      <footer className="codex-review-actions">
        <button
          className="secondary-button"
          disabled={isMutating}
          onClick={() => void handleAction("discard")}
          type="button"
        >
          {isZh ? "跳过变更" : "Skip change"}
        </button>
        <button
          className="primary-button"
          disabled={isMutating}
          onClick={() => void handleAction("apply")}
          type="button"
        >
          {isZh ? "应用变更" : "Apply change"}
        </button>
        {patch.rollback_available ? (
          <button
            className="chrome-button"
            disabled={isMutating}
            onClick={() => void handleAction("rollback")}
            type="button"
          >
            {isZh ? "回滚变更" : "Rollback change"}
          </button>
        ) : null}
      </footer>

      <MobileSheet
        disableDismiss={isMutating}
        eyebrow={localize(locale, { zh: "确认操作", en: "Confirm action" })}
        footer={
          <>
            <button
              className="secondary-button"
              disabled={isMutating}
              onClick={() => setPendingAction(null)}
              type="button"
            >
              {localize(locale, { zh: "取消", en: "Cancel" })}
            </button>
            <button
              className="danger-button"
              disabled={isMutating}
              onClick={() => void handleConfirmedAction()}
              type="button"
            >
              {pendingAction === "rollback"
                ? localize(locale, { zh: "回滚变更", en: "Rollback change" })
                : localize(locale, { zh: "跳过变更", en: "Skip change" })}
            </button>
          </>
        }
        open={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        title={
          pendingAction === "rollback"
            ? localize(locale, { zh: "要回滚已经应用的变更吗？", en: "Rollback the applied change?" })
            : localize(locale, { zh: "要跳过这次变更吗？", en: "Skip this change?" })
        }
      >
        <p className="codex-inline-note">
          {pendingAction === "rollback"
            ? localize(locale, {
                zh: "回滚会撤销已经应用到工作区的这次变更。",
                en: "Rollback will undo this change from the worktree."
              })
            : localize(locale, {
                zh: "跳过后，这次变更不会被应用到当前聊天的工作区。",
                en: "Skipping means this change will not be applied to the current chat worktree."
              })}
        </p>
      </MobileSheet>
    </CodexShell>
  );
}
