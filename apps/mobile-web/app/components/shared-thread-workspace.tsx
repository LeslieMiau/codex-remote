"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CodexCapabilitiesResponse,
  CodexLiveState,
  CodexMessage,
  CodexMessageDetail,
  CodexThread,
  CodexSharedSettingsResponse,
  CodexTranscriptPageResponse,
  GatewayEvent
} from "@codex-remote/protocol";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";

import {
  getCachedCapabilities,
  getCachedSharedSettings,
  getCachedTranscript,
  setCachedCapabilities,
  setCachedSharedSettings,
  setCachedTranscript
} from "../lib/client-cache";
import {
  GatewayRequestError,
  followUpRun,
  getCodexCapabilities,
  getCodexOverview,
  getCodexMessagesLatest,
  getCodexMessagesPage,
  getCodexSharedSettings,
  interruptSharedRun,
  resolveApproval,
  startSharedRun,
  subscribeToThreadStream,
  type TransportState
} from "../lib/gateway-client";
import { consumeThreadFlashMessage } from "../lib/flash-message";
import {
  formatDateTime,
  localize,
  transportLabel,
  translateApprovalKind,
  translateStatusText,
  translateThreadState,
  useLocale
} from "../lib/locale";
import {
  applyEventToLiveState,
  mergeMessages,
  mergeTranscript
} from "../lib/transcript";
import {
  buildInlineLiveDraft,
  renderLivePanelBody,
  type DisplayChatMessage
} from "../lib/live-draft";
import {
  beginPendingSend,
  clearPendingSend,
  editPendingSend,
  markPendingSendFailed,
  retryPendingSend,
  type PendingSendState
} from "../lib/pending-send";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import { CodexShell } from "./codex-shell";
import { MobileSheet } from "./mobile-sheet";

interface SharedThreadWorkspaceProps {
  threadId: string;
}

type MobilePanel = "details" | "threads" | null;
type ConfirmState =
  | {
      kind: "interrupt";
    }
  | {
      approvalId: string;
      kind: "reject-approval";
    }
  | null;

type PendingSend = PendingSendState;

interface LiveActivity {
  detail: string;
  title: string;
  tone: "neutral" | "warning" | "success" | "danger";
}

const PAGE_LIMIT = 10;
const POLL_INTERVAL_MS = 3_500;
const STREAM_REFRESH_DEBOUNCE_MS = 220;

function formatTimestamp(locale: "zh" | "en", value?: string) {
  if (!value) {
    return locale === "zh" ? "刚刚" : "Just now";
  }
  return formatDateTime(locale, value);
}

function capabilityMessage(
  locale: "zh" | "en",
  capabilities: CodexCapabilitiesResponse | null,
  fallback: { zh: string; en: string }
) {
  return capabilities?.reason ?? localize(locale, fallback);
}

function translateSyncState(
  locale: "zh" | "en",
  state: CodexTranscriptPageResponse["thread"]["sync_state"] | undefined
) {
  switch (state) {
    case "sync_pending":
      return localize(locale, { zh: "同步中", en: "Sync pending" });
    case "sync_failed":
      return localize(locale, { zh: "同步失败", en: "Sync failed" });
    default:
      return localize(locale, { zh: "已同步", en: "Synced" });
  }
}

function translateDetailKind(locale: "zh" | "en", kind: CodexMessageDetail["kind"]) {
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

function translateLiveStatus(
  locale: "zh" | "en",
  status: string,
  awaitingNativeCommit = false
) {
  if (awaitingNativeCommit) {
    return localize(locale, {
      zh: "等待原生确认",
      en: "Waiting for native commit"
    });
  }

  switch (status) {
    case "starting":
      return localize(locale, { zh: "准备中", en: "Starting" });
    case "waiting_approval":
      return localize(locale, { zh: "等待批准", en: "Waiting for approval" });
    case "needs_review":
      return localize(locale, { zh: "待审查", en: "Needs review" });
    case "completed":
      return localize(locale, { zh: "已完成", en: "Completed" });
    case "failed":
      return localize(locale, { zh: "失败", en: "Failed" });
    case "interrupted":
      return localize(locale, { zh: "已中断", en: "Interrupted" });
    case "resumed":
      return localize(locale, { zh: "继续生成", en: "Resumed" });
    default:
      return localize(locale, { zh: "生成中", en: "Streaming" });
  }
}

function translateLiveStateStatus(locale: "zh" | "en", liveState: CodexLiveState) {
  return translateLiveStatus(locale, liveState.status, liveState.awaiting_native_commit);
}

function liveStateTone(liveState: CodexLiveState): LiveActivity["tone"] {
  if (liveState.awaiting_native_commit) {
    return "warning";
  }

  switch (liveState.status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "interrupted":
    case "waiting_approval":
    case "needs_review":
      return "warning";
    default:
      return "neutral";
  }
}

function inferProgressActivity(
  locale: "zh" | "en",
  step: string | undefined,
  message: string | undefined
): LiveActivity {
  const haystack = `${step ?? ""} ${message ?? ""}`.toLowerCase();
  if (haystack.includes("test")) {
    return {
      title: localize(locale, { zh: "正在测试", en: "Running tests" }),
      detail: localize(locale, {
        zh: "Codex 正在执行验证或测试。",
        en: "Codex is validating changes or running tests."
      }),
      tone: "neutral"
    };
  }

  if (
    haystack.includes("edit") ||
    haystack.includes("patch") ||
    haystack.includes("write") ||
    haystack.includes("file")
  ) {
    return {
      title: localize(locale, { zh: "正在编辑", en: "Editing" }),
      detail: localize(locale, {
        zh: "Codex 正在改文件，详细过程已折叠到对应回复里。",
        en: "Codex is editing files. The detailed steps stay folded under the corresponding reply."
      }),
      tone: "neutral"
    };
  }

  return {
    title: localize(locale, { zh: "正在思考", en: "Thinking" }),
    detail: localize(locale, {
      zh: "Codex 正在分析请求，详细过程默认隐藏。",
      en: "Codex is reasoning about the request. Detailed process steps stay hidden by default."
    }),
    tone: "neutral"
  };
}

function liveActivityFromEvent(
  locale: "zh" | "en",
  event: GatewayEvent
): LiveActivity | null {
  switch (event.event_type) {
    case "turn.started":
      return {
        title: localize(locale, { zh: "开始处理", en: "Started" }),
        detail: localize(locale, {
          zh: "Codex 已收到你的消息。",
          en: "Codex received your message."
        }),
        tone: "neutral"
      };
    case "turn.progress":
      return inferProgressActivity(
        locale,
        typeof event.payload.step === "string" ? event.payload.step : undefined,
        typeof event.payload.message === "string" ? event.payload.message : undefined
      );
    case "approval.required":
      return {
        title: localize(locale, { zh: "等待批准", en: "Waiting for approval" }),
        detail: localize(locale, {
          zh: "Codex 已暂停，等待你批准继续执行。",
          en: "Codex paused and needs your approval before continuing."
        }),
        tone: "warning"
      };
    case "patch.ready":
      return {
        title: localize(locale, { zh: "待审查", en: "Needs review" }),
        detail: localize(locale, {
          zh: "新的变更已经准备好，建议现在打开查看。",
          en: "A new change is ready. Open the review view."
        }),
        tone: "warning"
      };
    case "turn.completed":
      return {
        title: localize(locale, { zh: "已完成", en: "Completed" }),
        detail:
          typeof event.payload.summary === "string" && event.payload.summary.length > 0
            ? event.payload.summary
            : localize(locale, {
                zh: "这轮任务已经完成。",
                en: "The current run completed."
              }),
        tone: "success"
      };
    case "turn.failed": {
      const failureMessage =
        typeof event.payload.message === "string" ? event.payload.message : undefined;
      return {
        title:
          event.payload.state === "interrupted"
            ? localize(locale, { zh: "已中断", en: "Interrupted" })
            : localize(locale, { zh: "执行失败", en: "Failed" }),
        detail:
          failureMessage ??
          localize(locale, {
            zh: "运行失败，需要继续跟进。",
            en: "The run failed and needs follow-up."
          }),
        tone: event.payload.state === "interrupted" ? "warning" : "danger"
      };
    }
    default:
      return null;
  }
}

function deriveLiveActivity(
  locale: "zh" | "en",
  transcript: CodexTranscriptPageResponse | null,
  transportState: TransportState,
  eventActivity: LiveActivity | null
) {
  if (!transcript) {
    return {
      title: localize(locale, { zh: "正在连接", en: "Connecting" }),
      detail: localize(locale, {
        zh: "正在同步这条聊天的最新状态。",
        en: "Syncing the latest state of this chat."
      }),
      tone: "neutral" as const
    };
  }

  if (transcript.thread.sync_state === "sync_failed") {
    return {
      title: localize(locale, { zh: "未同步到 Codex app", en: "Not synced to Codex app" }),
      detail: localize(locale, {
        zh: "最近一条消息尚未 materialize 到原生 Codex 时间线。",
        en: "The latest message has not materialized in native Codex state yet."
      }),
      tone: "danger" as const
    };
  }

  if (transcript.thread.sync_state === "sync_pending") {
    return {
      title: localize(locale, { zh: "等待原生同步", en: "Waiting for native sync" }),
      detail: localize(locale, {
        zh: "消息已经发出，正在等待进入 Codex app 的原生时间线。",
        en: "The message was sent and is waiting to enter the native Codex app timeline."
      }),
      tone: "warning" as const
    };
  }

  const pendingApprovals = transcript.approvals.filter(
    (approval) => approval.status === "requested"
  );
  const pendingPatches = transcript.patches.filter(
    (patch) => patch.status !== "applied" && patch.status !== "discarded"
  );

  if (pendingApprovals.length > 0) {
    return {
      title: localize(locale, { zh: "等待批准", en: "Waiting for approval" }),
      detail: localize(locale, {
        zh: "先处理批准请求，Codex 才会继续执行。",
        en: "Resolve the approval request to let Codex continue."
      }),
      tone: "warning" as const
    };
  }

  if (pendingPatches.length > 0) {
    return {
      title: localize(locale, { zh: "待审查", en: "Needs review" }),
      detail: localize(locale, {
        zh: "新的变更已经生成，建议先看完再继续发消息。",
        en: "A change is ready. Review it before moving on."
      }),
      tone: "warning" as const
    };
  }

  if (transcript.thread.state === "running") {
    return (
      eventActivity ?? {
        title: localize(locale, { zh: "运行中", en: "Running" }),
        detail: localize(locale, {
          zh: "Codex 正在继续处理这条聊天。",
          en: "Codex is actively working in this chat."
        }),
        tone: transportState === "websocket" ? "neutral" : "warning"
      }
    );
  }

  if (transcript.thread.state === "failed") {
    return {
      title: localize(locale, { zh: "执行失败", en: "Failed" }),
      detail: localize(locale, {
        zh: "这条聊天需要新的消息或一次人工处理。",
        en: "This chat needs a follow-up message or manual action."
      }),
      tone: "danger" as const
    };
  }

  if (transcript.thread.state === "interrupted") {
    return {
      title: localize(locale, { zh: "已中断", en: "Interrupted" }),
      detail: localize(locale, {
        zh: "上一次运行已停止，可以继续下一轮任务。",
        en: "The last run stopped. You can continue with the next task."
      }),
      tone: "warning" as const
    };
  }

  return {
    title: localize(locale, { zh: "可继续提问", en: "Ready for follow-up" }),
    detail: localize(locale, {
      zh: "默认只显示最新聊天内容，更早历史可以按需加载。",
      en: "Only the latest chat is shown by default. Older history can be loaded on demand."
    }),
    tone: "success" as const
  };
}

function renderMessageBody(
  locale: "zh" | "en",
  message: CodexMessage
) {
  if (message.body?.trim()) {
    return message.body;
  }

  if (message.role === "assistant") {
    return localize(locale, {
      zh: "Codex 正在处理这条请求，详细过程已折叠。",
      en: "Codex is processing this request. Detailed steps are folded below."
    });
  }

  return message.title ?? "";
}

function summarizeMessageBody(locale: "zh" | "en", message: CodexMessage | null) {
  if (!message) {
    return localize(locale, {
      zh: "最新回复会显示在这里。",
      en: "The latest reply will appear here."
    });
  }

  const body = renderMessageBody(locale, message).trim();
  if (!body) {
    return localize(locale, {
      zh: "Codex 正在准备新的回复。",
      en: "Codex is preparing a new reply."
    });
  }

  return body.length > 120 ? `${body.slice(0, 117)}...` : body;
}

function matchesConfirmedUserMessage(message: CodexMessage, pendingSend: PendingSend) {
  if (message.role !== "user" || message.origin !== "native_confirmed") {
    return false;
  }

  if ((message.body ?? "").trim() !== pendingSend.body.trim()) {
    return false;
  }

  const pendingTimestamp = Date.parse(pendingSend.created_at);
  const messageTimestamp = Date.parse(message.timestamp);
  if (Number.isNaN(pendingTimestamp) || Number.isNaN(messageTimestamp)) {
    return false;
  }

  return messageTimestamp >= pendingTimestamp - 30_000;
}

function reconcilePendingSends(
  pendingSends: PendingSend[],
  transcript: CodexTranscriptPageResponse
) {
  const nativeUserMessages = transcript.items.filter(
    (message) => message.role === "user" && message.origin === "native_confirmed"
  );
  const usedMessageIds = new Set<string>();
  let confirmedCount = 0;
  let failedCount = 0;

  const nextPendingSends = pendingSends.flatMap((pendingSend) => {
    const match = nativeUserMessages.find(
      (message) =>
        !usedMessageIds.has(message.message_id) &&
        matchesConfirmedUserMessage(message, pendingSend)
    );
    if (match) {
      usedMessageIds.add(match.message_id);
      confirmedCount += 1;
      return [];
    }

    if (pendingSend.status === "sending" && transcript.thread.sync_state === "sync_failed") {
      failedCount += 1;
      return [
        {
          ...pendingSend,
          status: "failed" as const
        }
      ];
    }

    return [pendingSend];
  });

  return {
    confirmedCount,
    failedCount,
    pendingSends: nextPendingSends
  };
}

function describeActionError(locale: "zh" | "en", error: unknown) {
  if (error instanceof GatewayRequestError && error.code === "native_approval_unrecoverable") {
    return localize(locale, {
      zh: "这个请求和原生 Codex 的连接已经丢失，请回到桌面端重新打开聊天后再处理。",
      en: "The native approval binding was lost. Reopen this chat in desktop Codex app and try again."
    });
  }

  return error instanceof Error ? error.message : String(error);
}

export function SharedThreadWorkspace({ threadId }: SharedThreadWorkspaceProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [transcript, setTranscript] = useState<CodexTranscriptPageResponse | null>(() =>
    getCachedTranscript(threadId)
  );
  const [capabilities, setCapabilities] = useState<CodexCapabilitiesResponse | null>(() =>
    getCachedCapabilities()
  );
  const [sharedSettings, setSharedSettings] = useState<CodexSharedSettingsResponse | null>(() =>
    getCachedSharedSettings()
  );
  const [liveState, setLiveState] = useState<CodexLiveState | null>(() =>
    getCachedTranscript(threadId)?.live_state ?? null
  );
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!getCachedTranscript(threadId));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [transportState, setTransportState] = useState<TransportState>("idle");
  const [eventActivity, setEventActivity] = useState<LiveActivity | null>(null);
  const [pendingSends, setPendingSends] = useState<PendingSend[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [approvalSheetOpen, setApprovalSheetOpen] = useState(false);
  const [dismissedApprovalId, setDismissedApprovalId] = useState<string | null>(null);
  const [switcherThreads, setSwitcherThreads] = useState<CodexThread[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [threadSwitcherError, setThreadSwitcherError] = useState<string | null>(null);
  const [composerReserve, setComposerReserve] = useState(220);
  const inFlightRef = useRef(false);
  const timelineBottomRef = useRef<HTMLDivElement | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const lastSeenSeqRef = useRef(transcript?.thread.last_stream_seq ?? 0);
  const transcriptRef = useRef(transcript);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerShellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setStoredLastActiveThread(threadId);
  }, [threadId]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    const cachedTranscript = getCachedTranscript(threadId);
    setTranscript(cachedTranscript);
    setCapabilities(getCachedCapabilities());
    setSharedSettings(getCachedSharedSettings());
    setLiveState(cachedTranscript?.live_state ?? null);
    setIsLoading(!cachedTranscript);
    setPendingSends([]);
    setToastMessage(null);
    setShowJumpToLatest(false);
    setEventActivity(null);
    setStreamNotice(null);
    setTransportState("idle");
    setMobilePanel(null);
    setConfirmState(null);
    setApprovalSheetOpen(false);
    setDismissedApprovalId(null);
    setThreadSwitcherError(null);
    lastSeenSeqRef.current = cachedTranscript?.thread.last_stream_seq ?? 0;
    transcriptRef.current = cachedTranscript;
  }, [threadId]);

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
        const [nextTranscript, nextCapabilities, nextSharedSettings] = await Promise.all([
          getCodexMessagesLatest(threadId, PAGE_LIMIT),
          getCodexCapabilities(),
          getCodexSharedSettings()
        ]);
        if (!cancelled) {
          const mergedTranscript = mergeTranscript(transcriptRef.current, nextTranscript);
          transcriptRef.current = mergedTranscript;
          setTranscript(mergedTranscript);
          setCachedTranscript(threadId, mergedTranscript);
          setLiveState(mergedTranscript.live_state ?? null);
          if (mergedTranscript) {
            setPendingSends((current) => {
              const reconciled = reconcilePendingSends(current, mergedTranscript!);
              if (reconciled.confirmedCount > 0) {
                setToastMessage(
                  localize(locale, {
                    zh: "最新消息已经进入原生聊天记录。",
                    en: "The latest message is now in native chat history."
                  })
                );
              }
              return reconciled.pendingSends;
            });
          }
          setCapabilities(nextCapabilities);
          setSharedSettings(nextSharedSettings);
          setCachedCapabilities(nextCapabilities);
          setCachedSharedSettings(nextSharedSettings);
          lastSeenSeqRef.current = nextTranscript.thread.last_stream_seq;
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(describeActionError(locale, loadError));
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
    const interval = window.setInterval(() => {
      void load(true);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [threadId]);

  useEffect(() => {
    if (!transcript) {
      return;
    }

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refreshLatest();
      }, STREAM_REFRESH_DEBOUNCE_MS);
    };

    const unsubscribe = subscribeToThreadStream({
      threadId,
      lastSeenSeq: lastSeenSeqRef.current || transcript.thread.last_stream_seq,
      onEvent(event) {
        lastSeenSeqRef.current = event.stream_seq;
        setEventActivity(liveActivityFromEvent(locale, event));
        setLiveState((current) =>
          applyEventToLiveState(
            current ?? transcriptRef.current?.live_state ?? null,
            event
          )
        );
        scheduleRefresh();
      },
      onTransport(state) {
        setTransportState(state);
        if (state !== "idle") {
          setStreamNotice(null);
        }
      },
      onError(message) {
        setStreamNotice(translateStatusText(locale, message));
      }
    });

    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [locale, threadId, Boolean(transcript)]);

  useEffect(() => {
    const handleScroll = () => {
      const distanceFromBottom =
        document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      setShowJumpToLatest(distanceFromBottom > 280);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }, [prompt]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4_000);

    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    const flashMessage = consumeThreadFlashMessage(threadId);
    if (flashMessage) {
      setToastMessage(flashMessage);
    }
  }, [threadId]);

  const pendingApprovals = useMemo(
    () => transcript?.approvals.filter((approval) => approval.status === "requested") ?? [],
    [transcript]
  );
  const pendingPatches = useMemo(
    () =>
      transcript?.patches.filter(
        (patch) => patch.status !== "applied" && patch.status !== "discarded"
      ) ?? [],
    [transcript]
  );
  const activeRunId = transcript?.thread.active_turn_id ?? null;
  const pendingApprovalsById = useMemo(
    () => new Map(pendingApprovals.map((approval) => [approval.approval_id, approval])),
    [pendingApprovals]
  );
  const isRunActive =
    Boolean(activeRunId) &&
    (transcript?.thread.state === "running" ||
      transcript?.thread.state === "waiting_approval");
  const composerDisabledReason = !transcript
    ? localize(locale, {
        zh: "正在加载聊天状态。",
        en: "Loading chat state."
      })
    : transcript.thread.archived
      ? localize(locale, {
          zh: "这条已归档聊天当前为只读状态。",
          en: "Archived chats are read-only."
        })
      : !capabilities?.run_start
        ? capabilityMessage(locale, capabilities, {
            zh: "当前 Codex 版本不支持在手机端发起共享运行。",
            en: "This Codex build cannot start shared runs from the phone."
          })
        : pendingApprovals.length > 0
          ? localize(locale, {
              zh: "先处理批准请求，再继续发新消息。",
              en: "Resolve the approval request before sending a new message."
            })
          : pendingPatches.length > 0
            ? localize(locale, {
                zh: "先完成变更审查，再继续发新消息。",
                en: "Review the pending change before sending a new message."
              })
        : isRunActive && !capabilities.live_follow_up
          ? localize(locale, {
              zh: "当前 Codex 版本暂不支持运行中追加指令。",
              en: "Live follow-up unavailable on this Codex build."
            })
          : null;
  const composerInputDisabled = !transcript || transcript.thread.archived || isMutating;

  const liveResponse = liveState;
  const liveDraftMessage = useMemo(
    () =>
      transcript
        ? buildInlineLiveDraft({
            liveState: liveResponse,
            locale,
            messages: transcript.items,
            threadId
          })
        : null,
    [liveResponse, locale, threadId, transcript]
  );
  const displayMessages = useMemo<DisplayChatMessage[]>(
    () =>
      liveDraftMessage ? [...(transcript?.items ?? []), liveDraftMessage] : (transcript?.items ?? []),
    [liveDraftMessage, transcript]
  );
  const liveResponseTone = liveResponse ? liveStateTone(liveResponse) : "neutral";
  const showLivePanel = Boolean(
    liveResponse &&
      (liveResponse.details.length > 0 ||
        liveResponse.awaiting_native_commit ||
        !liveDraftMessage)
  );
  const latestAssistantMessage = useMemo(
    () =>
      [...displayMessages]
        .reverse()
        .find((message) => message.role === "assistant") ??
      null,
    [displayMessages]
  );
  const liveActivity = deriveLiveActivity(locale, transcript, transportState, eventActivity);
  const syncStateLabel = translateSyncState(locale, transcript?.thread.sync_state);
  const selectedModelLabel =
    sharedSettings?.available_models.find((option) => option.slug === sharedSettings.model)
      ?.display_name ?? sharedSettings?.model ?? null;
  const leadApproval = pendingApprovals[0] ?? null;
  const leadPatch = pendingPatches[0] ?? null;
  const hasApprovalSheet = Boolean(leadApproval);
  const topStatus = error
    ? {
        detail: error,
        title: localize(locale, { zh: "需要处理的问题", en: "Something needs attention" }),
        tone: "danger" as const
      }
    : streamNotice
      ? {
          detail: streamNotice,
          title: localize(locale, { zh: "实时连接异常", en: "Live stream notice" }),
          tone: "warning" as const
        }
      : transportState === "idle" && transcript && !isLoading
        ? {
            detail: localize(locale, {
              zh: "实时流暂时中断，界面正在退回轮询同步。",
              en: "Live streaming paused for a moment. The view is temporarily falling back to polling."
            }),
            title: localize(locale, { zh: "正在重连", en: "Reconnecting" }),
            tone: "warning" as const
          }
        : transcript?.thread.sync_state === "sync_pending"
          ? {
              detail: localize(locale, {
                zh: "最新消息已经发出，正在等待进入 Codex app 的原生时间线。",
                en: "The latest message was sent and is waiting to enter the native Codex app timeline."
              }),
              title: localize(locale, { zh: "等待原生同步", en: "Waiting for native sync" }),
              tone: "warning" as const
            }
          : pendingSends.some((entry) => entry.status === "sending")
            ? {
                detail: localize(locale, {
                  zh: "消息已经提交到网关，会在原生时间线确认后进入正式会话记录。",
                  en: "Your message reached the gateway and will appear in the official transcript after native confirmation."
                }),
                title: localize(locale, { zh: "发送中", en: "Sending to Codex" }),
                tone: "warning" as const
              }
            : null;
  const activeTask = !leadApproval && !leadPatch && isRunActive
      ? {
          detail: liveActivity.detail,
          label: localize(locale, { zh: "当前状态", en: "Current activity" }),
          title: liveActivity.title,
          tone: liveActivity.tone
        }
      : {
          detail: summarizeMessageBody(locale, latestAssistantMessage),
          label: localize(locale, { zh: "最近回复", en: "Latest reply" }),
          title: localize(locale, { zh: "准备继续这条聊天", en: "Ready to continue this chat" }),
          tone: "success" as const
        };

  useEffect(() => {
    if (showJumpToLatest) {
      return;
    }

    timelineBottomRef.current?.scrollIntoView({ block: "end" });
  }, [displayMessages.length, liveDraftMessage?.timestamp, pendingSends.length, showJumpToLatest]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const composerShell = composerShellRef.current;
    if (!composerShell) {
      return;
    }

    let frame: number | null = null;

    const measureComposerReserve = () => {
      frame = null;
      const rect = composerShell.getBoundingClientRect();
      const nextReserve = Math.max(160, Math.ceil(window.innerHeight - rect.top));
      setComposerReserve((current) => (Math.abs(current - nextReserve) > 1 ? nextReserve : current));
    };

    const scheduleMeasure = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(measureComposerReserve);
    };

    scheduleMeasure();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(composerShell);

    const viewport = window.visualViewport;
    window.addEventListener("resize", scheduleMeasure);
    viewport?.addEventListener("resize", scheduleMeasure);
    viewport?.addEventListener("scroll", scheduleMeasure);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      viewport?.removeEventListener("resize", scheduleMeasure);
      viewport?.removeEventListener("scroll", scheduleMeasure);
    };
  }, [leadApproval?.approval_id, leadPatch?.patch_id]);

  useEffect(() => {
    if (!leadApproval) {
      setApprovalSheetOpen(false);
      setDismissedApprovalId(null);
      return;
    }

    if (leadApproval.approval_id !== dismissedApprovalId) {
      setApprovalSheetOpen(true);
    }
  }, [dismissedApprovalId, leadApproval]);

  function openApprovalSheet() {
    setDismissedApprovalId(null);
    setMobilePanel(null);
    setApprovalSheetOpen(true);
  }

  function closeApprovalSheet() {
    if (leadApproval) {
      setDismissedApprovalId(leadApproval.approval_id);
    }
    setApprovalSheetOpen(false);
  }

  function openPatchReview(patchId: string) {
    setMobilePanel(null);
    router.push(`/threads/${threadId}/patches/${patchId}`);
  }

  async function refreshLatest() {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      const [nextTranscript, nextCapabilities, nextSharedSettings] = await Promise.all([
        getCodexMessagesLatest(threadId, PAGE_LIMIT),
        getCodexCapabilities(),
        getCodexSharedSettings()
      ]);
      const mergedTranscript = mergeTranscript(transcriptRef.current, nextTranscript);
      transcriptRef.current = mergedTranscript;
      setTranscript(mergedTranscript);
      setCachedTranscript(threadId, mergedTranscript);
      setLiveState(mergedTranscript.live_state ?? null);
      if (mergedTranscript) {
        setPendingSends((current) => {
          const reconciled = reconcilePendingSends(current, mergedTranscript!);
          if (reconciled.confirmedCount > 0) {
            setToastMessage(
              localize(locale, {
                zh: "最新消息已经进入原生聊天记录。",
                en: "The latest message is now in native chat history."
              })
            );
          }
          return reconciled.pendingSends;
        });
      }
      setCapabilities(nextCapabilities);
      setSharedSettings(nextSharedSettings);
      setCachedCapabilities(nextCapabilities);
      setCachedSharedSettings(nextSharedSettings);
      lastSeenSeqRef.current = nextTranscript.thread.last_stream_seq;
      setError(null);
    } catch (loadError) {
      setError(describeActionError(locale, loadError));
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }

  async function openThreadSwitcher() {
    setMobilePanel("threads");
    setThreadSwitcherError(null);
    setIsLoadingThreads(true);
    try {
      const overview = await getCodexOverview();
      setSwitcherThreads(
        [...overview.threads].sort((left, right) =>
          right.updated_at.localeCompare(left.updated_at)
        )
      );
    } catch (loadError) {
      setThreadSwitcherError(describeActionError(locale, loadError));
    } finally {
      setIsLoadingThreads(false);
    }
  }

  function handleThreadSelect(nextThreadId: string) {
    setStoredLastActiveThread(nextThreadId);
    setMobilePanel(null);
    router.push(`/threads/${nextThreadId}`);
  }

  async function loadOlderMessages() {
    if (!transcript?.next_cursor || isLoadingOlder) {
      return;
    }

    setIsLoadingOlder(true);
    setError(null);
    try {
      const olderPage = await getCodexMessagesPage({
        threadId,
        cursor: transcript.next_cursor,
        limit: PAGE_LIMIT
      });
      setTranscript((current) => {
        if (!current) {
          transcriptRef.current = olderPage;
          setCachedTranscript(threadId, olderPage);
          setLiveState(olderPage.live_state ?? null);
          return olderPage;
        }
        const merged: CodexTranscriptPageResponse = {
          ...current,
          thread: olderPage.thread,
          approvals: olderPage.approvals,
          patches: olderPage.patches,
          live_state: olderPage.live_state,
          items: mergeMessages(olderPage.items, current.items),
          next_cursor: olderPage.next_cursor,
          has_more: olderPage.has_more
        };
        transcriptRef.current = merged;
        setCachedTranscript(threadId, merged);
        setLiveState(merged.live_state ?? null);
        return merged;
      });
    } catch (loadError) {
      setError(describeActionError(locale, loadError));
    } finally {
      setIsLoadingOlder(false);
    }
  }

  async function runMutation(action: () => Promise<void>, successMessage?: string) {
    setIsMutating(true);
    setError(null);

    try {
      await action();
      await refreshLatest();
      if (successMessage) {
        setToastMessage(successMessage);
      }
    } catch (actionError) {
      setError(describeActionError(locale, actionError));
    } finally {
      setIsMutating(false);
    }
  }

  async function submitPrompt(
    nextPrompt: string,
    options?: {
      pendingLocalId?: string;
    }
  ) {
    const trimmedPrompt = nextPrompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (composerDisabledReason) {
      setError(composerDisabledReason);
      return;
    }
    if (isMutating) {
      return;
    }

    const existingPending = options?.pendingLocalId
      ? pendingSends.find((entry) => entry.local_id === options.pendingLocalId) ?? null
      : null;
    if (options?.pendingLocalId && !existingPending) {
      return;
    }

    const pendingSend: PendingSend =
      existingPending ??
      beginPendingSend({
        local_id: options?.pendingLocalId,
        body: trimmedPrompt,
        prompt: trimmedPrompt
      });

    setPendingSends((current) =>
      options?.pendingLocalId
        ? retryPendingSend(current, options.pendingLocalId)
        : [...current, pendingSend]
    );
    setToastMessage(null);
    if (!options?.pendingLocalId) {
      setPrompt("");
    }
    setIsMutating(true);
    setError(null);
    setStreamNotice(null);
    setEventActivity(
      localize(locale, {
        zh: {
          title: "Sending to Codex...",
          detail: "消息已经交给网关，正在等待进入 Codex app 的原生时间线。",
          tone: "neutral"
        },
        en: {
          title: "Sending to Codex...",
          detail: "The gateway accepted your message and is waiting for native Codex confirmation.",
          tone: "neutral"
        }
      })
    );

    try {
      if (isRunActive && capabilities?.live_follow_up && activeRunId) {
        await followUpRun(activeRunId, trimmedPrompt);
      } else {
        await startSharedRun(threadId, trimmedPrompt);
      }
      await refreshLatest();
    } catch (actionError) {
      setPendingSends((current) => markPendingSendFailed(current, pendingSend.local_id));
      setError(describeActionError(locale, actionError));
    } finally {
      setIsMutating(false);
    }
  }

  async function handleRun() {
    await submitPrompt(prompt);
  }

  function handleRetryPendingSend(localId: string) {
    const target = pendingSends.find((entry) => entry.local_id === localId);
    if (!target) {
      return;
    }

    void submitPrompt(target.prompt, {
      pendingLocalId: localId
    });
  }

  function handleEditPendingSend(localId: string) {
    const nextState = editPendingSend(pendingSends, localId, prompt);
    setPendingSends(nextState.pendingSends);
    setPrompt(nextState.prompt);
    setError(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function handleDismissPendingSend(localId: string) {
    setPendingSends((current) => clearPendingSend(current, localId));
    setError(null);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    if (isMutating || !prompt.trim()) {
      return;
    }

    event.preventDefault();

    if (composerDisabledReason) {
      setError(composerDisabledReason);
      return;
    }

    void handleRun();
  }

  async function handleInterrupt() {
    if (!activeRunId) {
      return;
    }
    setConfirmState({
      kind: "interrupt"
    });
  }

  async function handleApproval(approvalId: string, approved: boolean) {
    if (!approved) {
      setConfirmState({
        approvalId,
        kind: "reject-approval"
      });
      return;
    }

    await runMutation(async () => {
      await resolveApproval(approvalId, approved);
    }, localize(locale, {
      zh: "批准请求已处理，Codex 会继续执行。",
      en: "The approval was handled and Codex can continue."
    }));
  }

  async function handleConfirmAction() {
    if (!confirmState) {
      return;
    }

    const nextConfirmState = confirmState;
    setConfirmState(null);

    switch (nextConfirmState.kind) {
      case "interrupt":
        if (!activeRunId) {
          return;
        }
        await runMutation(async () => {
          await interruptSharedRun(activeRunId);
        }, localize(locale, {
          zh: "当前运行已停止。",
          en: "The current run was stopped."
        }));
        return;
      case "reject-approval":
        await runMutation(async () => {
          await resolveApproval(nextConfirmState.approvalId, false);
        }, localize(locale, {
          zh: "批准请求已拒绝。",
          en: "The approval request was rejected."
        }));
        return;
    }
  }

  return (
    <CodexShell
      backHref="/projects"
      compactHeader
      eyebrow={transcript?.thread.project_label ?? (isZh ? "聊天" : "Chat")}
      subtitle={
        transcript?.thread.repo_root ??
        localize(locale, {
          zh: "正在连接共享聊天",
          en: "Connecting to shared chat"
        })
      }
      title={transcript?.thread.title ?? threadId}
      actions={
        <div className="codex-header-cues codex-thread-toolbar">
          <button
            className="chrome-button"
            onClick={() => void openThreadSwitcher()}
            type="button"
          >
            {localize(locale, { zh: "最近", en: "Recent" })}
          </button>
          <button
            className="chrome-button"
            onClick={() => setMobilePanel("details")}
            type="button"
          >
            {localize(locale, { zh: "信息", en: "Info" })}
          </button>
        </div>
      }
    >
      <div
        className="codex-thread-screen"
        style={
          {
            "--composer-reserve": `${composerReserve}px`
          } as CSSProperties
        }
      >
        {toastMessage ? (
          <div aria-live="polite" className="codex-toast" role="status">
            {toastMessage}
          </div>
        ) : null}

      <div className="codex-page-stack">
        {topStatus ? (
          <section className={`codex-status-strip tone-${topStatus.tone}`}>
            <div className="codex-status-strip__copy">
              <p className="section-label">{localize(locale, { zh: "状态", en: "Status" })}</p>
              <strong>{topStatus.title}</strong>
              <p>{topStatus.detail}</p>
            </div>
            <span className="state-pill">{transportLabel(locale, transportState)}</span>
          </section>
        ) : null}

        <section className="codex-page-section">
          <div className="codex-thread-context">
            <span className="status-dot">
              {localize(locale, { zh: "状态", en: "Status" })}{" "}
              {transcript
                ? translateThreadState(locale, transcript.thread.state)
                : localize(locale, { zh: "加载中", en: "Loading" })}
            </span>
            <span className="status-dot">
              {localize(locale, { zh: "同步", en: "Sync" })} {syncStateLabel}
            </span>
            <span className="status-dot">
              {localize(locale, { zh: "更新于", en: "Updated" })}{" "}
              {transcript
                ? formatTimestamp(locale, transcript.thread.updated_at)
                : localize(locale, { zh: "加载中", en: "Loading" })}
            </span>
            {selectedModelLabel ? (
              <span className="status-dot">
                {localize(locale, { zh: "模型", en: "Model" })} {selectedModelLabel}
              </span>
            ) : null}
            {sharedSettings?.model_reasoning_effort ? (
              <span className="status-dot">
                {localize(locale, { zh: "推理", en: "Reasoning" })}{" "}
                {sharedSettings.model_reasoning_effort}
              </span>
            ) : null}
          </div>
        </section>

        <section className="codex-status-area">
          <article className={`codex-task-card tone-${activeTask.tone}`}>
            <div className="codex-task-card__copy">
              <strong>{activeTask.title}</strong>
              <p>{activeTask.detail}</p>
            </div>

            <div className="codex-task-card__actions">
              {!leadApproval && !leadPatch && isRunActive ? (
                <button
                  className="secondary-button"
                  disabled={isMutating || !capabilities?.interrupt}
                  onClick={() => void handleInterrupt()}
                  type="button"
                >
                  {localize(locale, { zh: "停止", en: "Stop" })}
                </button>
              ) : null}
            </div>
          </article>
        </section>

        <section className="codex-thread-layout codex-thread-layout--chat">
          <div className="codex-timeline-column">
            <section className="codex-chat-section">
              <div className="codex-section__header">
                <div>
                  <p className="section-label">
                    {localize(locale, { zh: "消息", en: "Messages" })}
                  </p>
                  <h2>{localize(locale, { zh: "聊天记录", en: "Chat history" })}</h2>
                </div>
                {transcript?.has_more ? (
                  <button
                    className="secondary-button"
                    disabled={isLoadingOlder}
                    onClick={() => void loadOlderMessages()}
                    type="button"
                  >
                    {isLoadingOlder
                      ? localize(locale, { zh: "加载中", en: "Loading" })
                      : localize(locale, { zh: "更早消息", en: "Earlier messages" })}
                  </button>
                ) : null}
              </div>

              {liveResponse && showLivePanel ? (
                <article className={`codex-live-panel tone-${liveResponseTone}`}>
                  <div className="codex-live-panel__header">
                    <div className="codex-live-panel__copy">
                      <p className="section-label">
                        {localize(locale, { zh: "实时回复", en: "Live response" })}
                      </p>
                      <strong>
                        {liveResponse.awaiting_native_commit
                          ? localize(locale, {
                              zh: "等待原生 Codex 聊天记录确认",
                              en: "Waiting for native Codex confirmation"
                            })
                          : localize(locale, {
                              zh: "Codex 正在实时更新",
                              en: "Codex is updating live"
                            })}
                      </strong>
                      <p>{renderLivePanelBody(locale, liveResponse, Boolean(liveDraftMessage))}</p>
                    </div>
                    <div className="codex-live-panel__meta">
                      <span className="state-pill">
                        {translateLiveStateStatus(locale, liveResponse)}
                      </span>
                      <span className="status-dot">
                        {formatTimestamp(locale, liveResponse.updated_at)}
                      </span>
                    </div>
                  </div>

                  {liveResponse.awaiting_native_commit ? (
                    <p className="codex-inline-note">
                      {localize(locale, {
                        zh: "正式消息仍然只会在原生 Codex 聊天记录确认后进入下面的对话。",
                        en: "The chat below updates only after native Codex confirms the official message."
                      })}
                    </p>
                  ) : null}

                  {liveResponse.details.length > 0 ? (
                    <div className="codex-live-panel__details">
                      {liveResponse.details.map((detail) => (
                        <details key={detail.detail_id} className="codex-detail-disclosure">
                          <summary>
                            <span>{translateDetailKind(locale, detail.kind)}</span>
                            <strong>{detail.title}</strong>
                            <span>{formatTimestamp(locale, detail.timestamp)}</span>
                          </summary>
                          {detail.body ? (
                            detail.mono ? (
                              <pre className="codex-mono-block">{detail.body}</pre>
                            ) : (
                              <p className="codex-detail-body">{detail.body}</p>
                            )
                          ) : null}
                        </details>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : null}

              <div className="codex-chat-list">
                {displayMessages.map((message) => (
                  <article
                    key={message.message_id}
                    className={`codex-chat-message role-${message.role} ${
                      message.is_live_draft ? "is-live-draft" : ""
                    }`}
                  >

                    <div className="codex-chat-bubble">
                      <p className="codex-message-body">{renderMessageBody(locale, message)}</p>

                      {message.is_live_draft ? (
                        <p className="codex-inline-note codex-live-draft-note">
                          {message.awaiting_native_commit
                            ? localize(locale, {
                                zh: "正式消息正在进入原生 Codex 聊天记录，请稍等。",
                                en: "The official message is entering native Codex chat history. Please wait."
                              })
                            : localize(locale, {
                                zh: "消息加载中，请稍等。",
                                en: "Message loading, please wait."
                              })}
                        </p>
                      ) : null}

                      {message.role === "assistant" && message.details.length > 0 ? (
                        <details className="codex-message-details">
                          <summary>
                            {localize(locale, {
                              zh: `查看过程与读取 (${message.details.length})`,
                              en: `Show process and reads (${message.details.length})`
                            })}
                          </summary>
                          <div className="codex-message-details__list">
                            {message.details.map((detail) => (
                              <details key={detail.detail_id} className="codex-detail-disclosure">
                                <summary>
                                  <span>{translateDetailKind(locale, detail.kind)}</span>
                                  <strong>{detail.title}</strong>
                                  <span>{formatTimestamp(locale, detail.timestamp)}</span>
                                </summary>
                                {detail.body ? (
                                  detail.mono ? (
                                    <pre className="codex-mono-block">{detail.body}</pre>
                                  ) : (
                                    <p className="codex-detail-body">{detail.body}</p>
                                  )
                                ) : null}
                              </details>
                            ))}
                          </div>
                        </details>
                      ) : null}

                      {message.role === "system_action" && message.approval_id ? (
                        <p className="codex-inline-note">
                          {!pendingApprovalsById.get(message.approval_id)?.recoverable
                            ? localize(locale, {
                                zh: "这个批准请求只能回到桌面 Codex app 处理。",
                                en: "This approval can only be resolved from desktop Codex app now."
                              })
                            : localize(locale, {
                                zh: "批准操作现在会在页面内审批弹窗里处理。",
                                en: "Approval now opens from the in-page approval sheet."
                              })}
                        </p>
                      ) : null}

                      {message.role === "system_action" && message.patch_id ? (
                        <p className="codex-inline-note">
                          {localize(locale, {
                            zh: "需要查看变更时，请使用输入区上方的审查入口继续。",
                            en: "Use the review gate above the composer when a change is waiting."
                          })}
                        </p>
                      ) : null}
                    </div>
                  </article>
                ))}

                {pendingSends.map((pendingSend) => (
                  <article
                    key={pendingSend.local_id}
                    className="codex-chat-message role-user is-pending-send"
                  >
                    <div className="codex-chat-bubble">
                      <p className="codex-message-body">{pendingSend.body}</p>
                      {pendingSend.status === "failed" ? (
                        <>
                          <p className="codex-inline-note">
                            {localize(locale, {
                              zh: "发送失败。你可以重试，或放回输入框修改。",
                              en: "Failed to send. Retry or edit."
                            })}
                          </p>
                          <div className="codex-pending-send-actions">
                            <button
                              className="secondary-button"
                              disabled={isMutating}
                              onClick={() => handleRetryPendingSend(pendingSend.local_id)}
                              type="button"
                            >
                              {localize(locale, { zh: "重试", en: "Retry" })}
                            </button>
                            <button
                              className="secondary-button"
                              disabled={isMutating}
                              onClick={() => handleEditPendingSend(pendingSend.local_id)}
                              type="button"
                            >
                              {localize(locale, { zh: "编辑", en: "Edit" })}
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}

                {!isLoading && displayMessages.length === 0 ? (
                  <div className="codex-empty-panel">
                    <p>
                      {localize(locale, {
                        zh: "这条聊天里还没有消息。",
                        en: "No messages yet in this chat."
                      })}
                    </p>
                  </div>
                ) : null}
                <div ref={timelineBottomRef} />
              </div>
            </section>
          </div>
        </section>
      </div>

      <MobileSheet
        eyebrow={localize(locale, { zh: "聊天", en: "Chats" })}
        footer={
          <Link className="secondary-button" href="/projects" onClick={() => setMobilePanel(null)}>
            {localize(locale, { zh: "打开聊天列表", en: "Open chats" })}
          </Link>
        }
        open={mobilePanel === "threads"}
        onClose={() => setMobilePanel(null)}
        title={localize(locale, { zh: "切换对话", en: "Switch chats" })}
      >
        {threadSwitcherError ? (
          <section aria-live="assertive" className="codex-status-strip codex-status-strip--stacked tone-danger" role="alert">
            <div className="codex-status-strip__copy">
              <p className="section-label">{localize(locale, { zh: "对话列表异常", en: "Chat list issue" })}</p>
              <strong>{localize(locale, { zh: "最近对话暂时不可用", en: "Recent chats are temporarily unavailable" })}</strong>
              <p>{threadSwitcherError}</p>
            </div>
          </section>
        ) : null}
        <div className="thread-list">
          {isLoadingThreads ? (
            <p className="codex-side-empty">
              {localize(locale, { zh: "正在加载最近对话。", en: "Loading recent chats." })}
            </p>
          ) : switcherThreads.length === 0 ? (
            <p className="codex-side-empty">
              {localize(locale, { zh: "当前还没有别的对话。", en: "No other chats yet." })}
            </p>
          ) : (
            switcherThreads.map((thread) => (
              <button
                key={thread.thread_id}
                className={`thread-row ${thread.thread_id === threadId ? "is-current" : ""}`}
                onClick={() => handleThreadSelect(thread.thread_id)}
                type="button"
              >
                <div className="thread-row__main">
                  <strong>{thread.title}</strong>
                  <span>{thread.project_label}</span>
                </div>
                <div className="thread-row__meta">
                  <span className="state-pill">
                    {translateThreadState(locale, thread.state)}
                  </span>
                  {thread.pending_approvals > 0 ? (
                    <span className="status-dot">
                      {isZh
                        ? `${thread.pending_approvals} 个待批准`
                        : `${thread.pending_approvals} approvals`}
                    </span>
                  ) : null}
                  {thread.pending_patches > 0 ? (
                    <span className="status-dot">
                      {isZh
                        ? `${thread.pending_patches} 个待审查`
                        : `${thread.pending_patches} reviews`}
                    </span>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
      </MobileSheet>

      <MobileSheet
        eyebrow={localize(locale, { zh: "信息", en: "Info" })}
        open={mobilePanel === "details"}
        onClose={() => setMobilePanel(null)}
        title={localize(locale, { zh: "聊天信息", en: "Chat info" })}
      >
        <div className="codex-side-list">
          <article className="codex-side-item">
            <strong>{localize(locale, { zh: "聊天状态", en: "Chat status" })}</strong>
            <div className="codex-side-list">
              <div className="codex-side-row">
                <span>{localize(locale, { zh: "状态", en: "Status" })}</span>
                <span>{transcript ? translateThreadState(locale, transcript.thread.state) : "-"}</span>
              </div>
              <div className="codex-side-row">
                <span>{localize(locale, { zh: "同步", en: "Sync" })}</span>
                <span>{syncStateLabel}</span>
              </div>
              <div className="codex-side-row">
                <span>{localize(locale, { zh: "连接", en: "Transport" })}</span>
                <span>{transportLabel(locale, transportState)}</span>
              </div>
              <div className="codex-side-row">
                <span>{localize(locale, { zh: "聊天 ID", en: "Chat ID" })}</span>
                <span>{threadId}</span>
              </div>
            </div>
          </article>

          <article className="codex-side-item">
            <strong>{localize(locale, { zh: "聊天设置", en: "Chat settings" })}</strong>
            <div className="codex-side-list">
              <div className="codex-side-row">
                <span>{localize(locale, { zh: "模型", en: "Model" })}</span>
                <span>{selectedModelLabel ?? "-"}</span>
              </div>
              <div className="codex-side-row">
                <span>{localize(locale, { zh: "推理", en: "Reasoning" })}</span>
                <span>{sharedSettings?.model_reasoning_effort ?? "-"}</span>
              </div>
            </div>
          </article>

          <article className="codex-side-item">
            <strong>{localize(locale, { zh: "快捷操作", en: "Quick actions" })}</strong>
            <div className="feed-actions">
              <button
                className="secondary-button"
                disabled={isMutating || isLoading}
                onClick={() => void refreshLatest()}
                type="button"
              >
                {localize(locale, { zh: "刷新", en: "Refresh" })}
              </button>
              <Link className="chrome-button" href="/projects" onClick={() => setMobilePanel(null)}>
                {localize(locale, { zh: "打开聊天列表", en: "Open chats" })}
              </Link>
            </div>
          </article>
        </div>
      </MobileSheet>

      <MobileSheet
        eyebrow={localize(locale, { zh: "确认操作", en: "Confirm action" })}
        footer={
          <>
            <button
              className="secondary-button"
              onClick={() => setConfirmState(null)}
              type="button"
            >
              {localize(locale, { zh: "取消", en: "Cancel" })}
            </button>
            <button
              className="danger-button"
              onClick={() => void handleConfirmAction()}
              type="button"
            >
              {confirmState?.kind === "interrupt"
                ? localize(locale, { zh: "停止运行", en: "Stop run" })
                : localize(locale, { zh: "拒绝请求", en: "Reject request" })}
            </button>
          </>
        }
        open={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        title={
          confirmState?.kind === "interrupt"
            ? localize(locale, { zh: "停止当前运行？", en: "Stop the current run?" })
            : localize(locale, { zh: "拒绝这条批准请求？", en: "Reject this approval request?" })
        }
      >
        <p className="codex-inline-note">
          {confirmState?.kind === "interrupt"
            ? localize(locale, {
                zh: "Codex 会停止当前这轮运行，但这条聊天和现有输出会继续保留。",
                en: "Codex will stop the current run, but this chat and its current output will remain available."
              })
            : localize(locale, {
                zh: "拒绝后，Codex 不会继续执行这条需要批准的操作。",
                en: "Rejecting means Codex will not continue with this approval-gated action."
              })}
        </p>
      </MobileSheet>

        {showJumpToLatest ? (
        <button
          className="codex-jump-latest"
          onClick={() => timelineBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
          type="button"
        >
          {localize(locale, { zh: "回到最新", en: "Latest" })}
        </button>
        ) : null}

        <footer ref={composerShellRef} className="codex-composer">
        {leadApproval ? (
          <div className="codex-composer-gate">
            <div className="codex-composer-gate__copy">
              <p className="section-label">{localize(locale, { zh: "请求", en: "Request" })}</p>
              <strong>{translateApprovalKind(locale, leadApproval.kind)}</strong>
              <p>
                {leadApproval.recoverable
                  ? localize(locale, {
                      zh: "先在页面内处理这条批准请求，Codex 才会继续执行。",
                      en: "Handle this approval from the in-page sheet before Codex can continue."
                    })
                  : localize(locale, {
                      zh: "这条批准请求已经失去原生绑定，只能回到桌面 Codex app 处理。",
                      en: "This approval lost its native binding and must be resolved from desktop Codex app."
                    })}
              </p>
            </div>
            <button className="secondary-button" onClick={openApprovalSheet} type="button">
              {localize(locale, { zh: "处理请求", en: "Open request" })}
            </button>
          </div>
        ) : leadPatch ? (
          <div className="codex-composer-gate">
            <div className="codex-composer-gate__copy">
              <p className="section-label">{localize(locale, { zh: "变更审查", en: "Change review" })}</p>
              <strong>{localize(locale, { zh: "查看最新变更", en: "Review the latest change" })}</strong>
              <p>
                {leadPatch.files.length > 0
                  ? `${leadPatch.summary} · ${leadPatch.files.map((file) => file.path).join(", ")}`
                  : leadPatch.summary}
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={() => openPatchReview(leadPatch.patch_id)}
              type="button"
            >
              {localize(locale, { zh: "打开变更审查", en: "Open change review" })}
            </button>
          </div>
        ) : null}

        <div className="composer-row">
          <div className="codex-composer-input-wrap">
            <textarea
              ref={composerRef}
              id="shared-thread-prompt"
              className="composer-input"
              placeholder={localize(locale, {
                zh: "继续发消息，告诉 Codex 下一步要做什么。",
                en: "Send the next message and tell Codex what to do in this chat."
              })}
              rows={1}
              enterKeyHint="send"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onFocus={() => setMobilePanel(null)}
              disabled={composerInputDisabled}
            />
            <button
              aria-label={
                isMutating
                  ? localize(locale, { zh: "发送中", en: "Sending" })
                  : isRunActive
                    ? localize(locale, { zh: "继续", en: "Continue" })
                    : localize(locale, { zh: "发送", en: "Send" })
              }
              className={`codex-send-trigger ${isMutating ? "is-loading" : ""}`}
              disabled={Boolean(composerDisabledReason) || isMutating || !prompt.trim()}
              onClick={() => void handleRun()}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path
                  d="M5 7v6a4 4 0 0 0 4 4h10"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path
                  d="M14 9l-3 4 3 4"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>
          {isRunActive ? (
            <div className="workspace-actions workspace-actions--single">
              <button
                className="danger-button"
                disabled={isMutating || !capabilities?.interrupt}
                onClick={() => void handleInterrupt()}
                type="button"
              >
                {localize(locale, { zh: "停止", en: "Stop" })}
              </button>
            </div>
          ) : null}
        </div>
        </footer>

      <MobileSheet
        eyebrow={localize(locale, { zh: "请求", en: "Request" })}
        footer={
          leadApproval?.recoverable ? (
            <>
              <button
                className="secondary-button"
                disabled={isMutating}
                onClick={() => void handleApproval(leadApproval.approval_id, false)}
                type="button"
              >
                {localize(locale, { zh: "拒绝", en: "Reject" })}
              </button>
              <button
                className="primary-button"
                disabled={isMutating}
                onClick={() => void handleApproval(leadApproval.approval_id, true)}
                type="button"
              >
                {localize(locale, { zh: "批准", en: "Approve" })}
              </button>
            </>
          ) : (
            <button className="secondary-button" onClick={closeApprovalSheet} type="button">
              {localize(locale, { zh: "关闭", en: "Close" })}
            </button>
          )
        }
        open={hasApprovalSheet && approvalSheetOpen}
        onClose={closeApprovalSheet}
        title={localize(locale, { zh: "处理这条请求", en: "Respond to this request" })}
      >
        {leadApproval ? (
          <div className="codex-side-list">
            <article className="codex-side-item">
              <p className="section-label">{localize(locale, { zh: "请求类型", en: "Request type" })}</p>
              <strong>{translateApprovalKind(locale, leadApproval.kind)}</strong>
              <p>{leadApproval.reason}</p>
              <div className="codex-page-card__meta">
                <span className="status-dot">
                  {localize(locale, { zh: "请求于", en: "Requested" })}{" "}
                  {formatTimestamp(locale, leadApproval.requested_at)}
                </span>
                {pendingApprovals.length > 1 ? (
                  <span className="status-dot">
                    {isZh
                      ? `还有 ${pendingApprovals.length - 1} 条待处理`
                      : `${pendingApprovals.length - 1} more waiting`}
                  </span>
                ) : null}
              </div>
            </article>

            <p className="codex-inline-note">
              {leadApproval.recoverable
                ? localize(locale, {
                    zh: "批准后 Codex 会继续执行；拒绝会终止这次需要批准的操作。",
                    en: "Approving lets Codex continue. Rejecting stops this approval-gated action."
                  })
                : localize(locale, {
                    zh: "这个请求无法再从移动端恢复处理，请回到桌面 Codex app 完成。",
                    en: "This request can no longer be recovered from mobile. Finish it from desktop Codex app."
                  })}
            </p>
          </div>
        ) : null}
        </MobileSheet>
      </div>
    </CodexShell>
  );
}
