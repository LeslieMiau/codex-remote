"use client";

import type {
  CodexCapabilitiesResponse,
  CodexLiveState,
  CodexMessage,
  CodexSharedSettingsResponse,
  CodexTranscriptPageResponse,
  GatewayEvent
} from "@codex-remote/protocol";
import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";

import {
  getCachedCapabilities,
  getCachedSharedSettings,
  getCachedTranscript,
  setCachedCapabilities,
  setCachedSharedSettings,
  setCachedTranscript
} from "./client-cache";
import {
  GatewayRequestError,
  getCodexCapabilities,
  getCodexMessagesLatest,
  getCodexMessagesPage,
  getCodexSharedSettings,
  subscribeToThreadStream,
  type TransportState
} from "./gateway-client";
import {
  buildInlineLiveDraft,
  type DisplayChatMessage
} from "./live-draft";
import { type Locale, localize, translateStatusText } from "./locale";
import type { PendingSendState } from "./pending-send";
import {
  applyEventToLiveState,
  applyEventToTranscript,
  mergeMessages,
  mergeTranscript
} from "./transcript";
import {
  buildChatTimelineItems,
  getVisibleTimelineItems,
  type ChatTimelineItem
} from "./chat-timeline";

const INITIAL_TIMELINE_WINDOW = 60;
const TIMELINE_EXPAND_BATCH = 40;
const POLL_INTERVAL_MS = 3_500;
const STREAM_REFRESH_DEBOUNCE_MS = 220;
const SCROLL_TOP_THRESHOLD_PX = 64;
const NEAR_BOTTOM_THRESHOLD_PX = 96;
const REFRESH_EVENT_TYPES = new Set([
  "approval.required",
  "native_request.required",
  "native_request.resolved",
  "patch.ready",
  "thread.metadata.updated",
  "turn.completed",
  "turn.failed"
]);

export interface LiveActivity {
  detail: string;
  title: string;
  tone: "danger" | "neutral" | "success" | "warning";
}

export interface ThreadRealtimeState {
  capabilities: CodexCapabilitiesResponse | null;
  displayMessages: DisplayChatMessage[];
  error: string | null;
  eventActivity: LiveActivity | null;
  hiddenTimelineItemCount: number;
  isLoading: boolean;
  isLoadingOlder: boolean;
  isRefreshing: boolean;
  latestAssistantMessage: CodexMessage | null;
  liveState: CodexLiveState | null;
  scrollViewportRef: MutableRefObject<HTMLDivElement | null>;
  setError: Dispatch<SetStateAction<string | null>>;
  setStreamNotice: Dispatch<SetStateAction<string | null>>;
  sharedSettings: CodexSharedSettingsResponse | null;
  showJumpToLatest: boolean;
  streamNotice: string | null;
  timelineItems: ChatTimelineItem[];
  transcript: CodexTranscriptPageResponse | null;
  transportState: TransportState;
  unreadTimelineItems: number;
  handleTimelineScroll(): void;
  loadEarlierTimeline(): Promise<void>;
  refreshLatest(): Promise<void>;
  scrollToLatest(behavior?: ScrollBehavior): void;
}

interface UseThreadRealtimeStateInput {
  locale: Locale;
  onToast(message: string): void;
  pendingSends: PendingSendState[];
  setPendingSends: Dispatch<SetStateAction<PendingSendState[]>>;
  threadId: string;
}

export function liveStateTone(liveState: CodexLiveState) {
  if (liveState.awaiting_native_commit) {
    return "warning" as const;
  }

  switch (liveState.status) {
    case "completed":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "interrupted":
    case "waiting_approval":
    case "needs_review":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

function inferProgressActivity(
  locale: Locale,
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
  locale: Locale,
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
    case "native_request.required":
      return {
        title: localize(locale, { zh: "等待输入", en: "Waiting for input" }),
        detail: localize(locale, {
          zh: "Codex 需要你补充信息后才能继续。",
          en: "Codex needs more input from you before it can continue."
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

function matchesConfirmedUserMessage(message: CodexMessage, pendingSend: PendingSendState) {
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
  pendingSends: PendingSendState[],
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

export function shouldRefreshThreadAfterEvent(event: GatewayEvent) {
  return REFRESH_EVENT_TYPES.has(event.event_type);
}

export function describeActionError(locale: Locale, error: unknown) {
  if (error instanceof GatewayRequestError && error.code === "thread_sync_pending") {
    return localize(locale, {
      zh: "这条聊天还在等待原生 Codex 同步，稍后再试这些线程操作。",
      en: "This chat is still waiting for native Codex sync. Try those thread actions again in a moment."
    });
  }

  if (error instanceof GatewayRequestError && error.code === "native_approval_unrecoverable") {
    return localize(locale, {
      zh: "这个请求和原生 Codex 的连接已经丢失，请回到桌面端重新打开聊天后再处理。",
      en: "The native approval binding was lost. Reopen this chat in desktop Codex app and try again."
    });
  }

  if (error instanceof GatewayRequestError && error.code === "native_request_unrecoverable") {
    return localize(locale, {
      zh: "这条补充输入请求已经无法从手机端恢复，请回到桌面端继续处理。",
      en: "This input request can no longer be recovered from mobile. Continue it from desktop Codex."
    });
  }

  return error instanceof Error ? error.message : String(error);
}

function useStableEvent<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);
  const stableCallbackRef = useRef<T | null>(null);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  if (stableCallbackRef.current === null) {
    stableCallbackRef.current = ((...args: Parameters<T>) =>
      callbackRef.current(...args)) as T;
  }

  return stableCallbackRef.current;
}

export function useThreadRealtimeState({
  locale,
  onToast,
  pendingSends,
  setPendingSends,
  threadId
}: UseThreadRealtimeStateInput): ThreadRealtimeState {
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
  const [error, setError] = useState<string | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!getCachedTranscript(threadId));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [transportState, setTransportState] = useState<TransportState>("idle");
  const [eventActivity, setEventActivity] = useState<LiveActivity | null>(null);
  const [visibleTimelineCount, setVisibleTimelineCount] = useState(INITIAL_TIMELINE_WINDOW);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [unreadTimelineItems, setUnreadTimelineItems] = useState(0);
  const inFlightRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const lastSeenSeqRef = useRef(transcript?.thread.last_stream_seq ?? 0);
  const transcriptRef = useRef(transcript);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const restoreScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(
    null
  );
  const skipNextTimelineReactionRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const lastVisibleTimelineSnapshotRef = useRef<{
    count: number;
    lastId: string | null;
  }>({
    count: 0,
    lastId: null
  });

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    setCachedCapabilities(capabilities);
  }, [capabilities]);

  useEffect(() => {
    setCachedSharedSettings(sharedSettings);
  }, [sharedSettings]);

  useEffect(() => {
    setCachedTranscript(threadId, transcript);
    lastSeenSeqRef.current = transcript?.thread.last_stream_seq ?? lastSeenSeqRef.current;
  }, [threadId, transcript]);

  useEffect(() => {
    const cachedTranscript = getCachedTranscript(threadId);
    setTranscript(cachedTranscript);
    setCapabilities(getCachedCapabilities());
    setSharedSettings(getCachedSharedSettings());
    setLiveState(cachedTranscript?.live_state ?? null);
    setError(null);
    setStreamNotice(null);
    setIsLoading(!cachedTranscript);
    setIsRefreshing(false);
    setIsLoadingOlder(false);
    setTransportState("idle");
    setEventActivity(null);
    setVisibleTimelineCount(INITIAL_TIMELINE_WINDOW);
    setShowJumpToLatest(false);
    setUnreadTimelineItems(0);
    lastSeenSeqRef.current = cachedTranscript?.thread.last_stream_seq ?? 0;
    transcriptRef.current = cachedTranscript;
    shouldStickToBottomRef.current = true;
    restoreScrollAnchorRef.current = null;
    skipNextTimelineReactionRef.current = false;
    initialScrollDoneRef.current = false;
    lastVisibleTimelineSnapshotRef.current = {
      count: 0,
      lastId: null
    };
  }, [threadId]);

  const applyFetchedSnapshot = useStableEvent(
    (
      nextTranscript: CodexTranscriptPageResponse,
      nextCapabilities: CodexCapabilitiesResponse,
      nextSharedSettings: CodexSharedSettingsResponse
    ) => {
      const mergedTranscript = mergeTranscript(transcriptRef.current, nextTranscript);
      transcriptRef.current = mergedTranscript;
      startTransition(() => {
        setTranscript(mergedTranscript);
        setLiveState(mergedTranscript.live_state ?? null);
        setCapabilities(nextCapabilities);
        setSharedSettings(nextSharedSettings);
        setError(null);
      });
      setPendingSends((current) => {
        const reconciled = reconcilePendingSends(current, mergedTranscript);
        if (reconciled.confirmedCount > 0) {
          onToast(
            localize(locale, {
              zh: "最新消息已经进入原生聊天记录。",
              en: "The latest message is now in native chat history."
            })
          );
        }
        return reconciled.pendingSends;
      });
      lastSeenSeqRef.current = nextTranscript.thread.last_stream_seq;
    }
  );

  const syncLatest = useStableEvent(async (background = false) => {
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
        getCodexMessagesLatest(threadId, 10),
        getCodexCapabilities(),
        getCodexSharedSettings()
      ]);
      applyFetchedSnapshot(nextTranscript, nextCapabilities, nextSharedSettings);
    } catch (loadError) {
      setError(describeActionError(locale, loadError));
    } finally {
      inFlightRef.current = false;
      if (background) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  });

  useEffect(() => {
    void syncLatest(false);
  }, [threadId]);

  useEffect(() => {
    if (transportState !== "idle" || typeof document === "undefined") {
      return;
    }

    let timeout: number | null = null;

    const schedule = () => {
      if (document.hidden) {
        return;
      }
      timeout = window.setTimeout(() => {
        void syncLatest(true);
        schedule();
      }, POLL_INTERVAL_MS);
    };

    schedule();

    return () => {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [threadId, transportState]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibility = () => {
      if (!document.hidden) {
        void syncLatest(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToThreadStream({
      threadId,
      lastSeenSeq: lastSeenSeqRef.current,
      onEvent(event) {
        lastSeenSeqRef.current = event.stream_seq;
        setEventActivity(liveActivityFromEvent(locale, event));
        setLiveState((current) =>
          applyEventToLiveState(current ?? transcriptRef.current?.live_state ?? null, event)
        );
        startTransition(() => {
          setTranscript((current) => {
            const nextTranscript = applyEventToTranscript(current, event);
            if (!nextTranscript) {
              return current ?? null;
            }
            return {
              ...nextTranscript,
              thread: {
                ...nextTranscript.thread,
                last_stream_seq: Math.max(
                  nextTranscript.thread.last_stream_seq ?? 0,
                  event.stream_seq
                )
              }
            };
          });
        });

        if (shouldRefreshThreadAfterEvent(event)) {
          if (refreshTimerRef.current) {
            window.clearTimeout(refreshTimerRef.current);
          }
          refreshTimerRef.current = window.setTimeout(() => {
            refreshTimerRef.current = null;
            void syncLatest(true);
          }, STREAM_REFRESH_DEBOUNCE_MS);
        }
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
  }, [locale, threadId]);

  const liveDraftMessage = useMemo(
    () =>
      transcript
        ? buildInlineLiveDraft({
            liveState,
            locale,
            messages: transcript.items,
            threadId
          })
        : null,
    [liveState, locale, threadId, transcript]
  );

  const displayMessages = useMemo<DisplayChatMessage[]>(
    () =>
      liveDraftMessage ? [...(transcript?.items ?? []), liveDraftMessage] : (transcript?.items ?? []),
    [liveDraftMessage, transcript]
  );

  const liveBannerItem = useMemo(
    () =>
      liveState &&
      (liveState.details.length > 0 || liveState.awaiting_native_commit || !liveDraftMessage)
        ? {
            live_state: liveState,
            tone: liveStateTone(liveState),
            has_inline_draft: Boolean(liveDraftMessage)
          }
        : null,
    [liveDraftMessage, liveState]
  );

  const allTimelineItems = useMemo(
    () =>
      buildChatTimelineItems({
        messages: displayMessages,
        pendingSends,
        liveBanner: liveBannerItem
      }),
    [displayMessages, liveBannerItem, pendingSends]
  );

  const visibleTimeline = useMemo(
    () => getVisibleTimelineItems(allTimelineItems, visibleTimelineCount),
    [allTimelineItems, visibleTimelineCount]
  );

  const latestAssistantMessage = useMemo(
    () =>
      [...displayMessages]
        .reverse()
        .find((message) => message.role === "assistant") ?? null,
    [displayMessages]
  );

  const captureScrollAnchor = useStableEvent(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    restoreScrollAnchorRef.current = {
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop
    };
    skipNextTimelineReactionRef.current = true;
  });

  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current;
    const restore = restoreScrollAnchorRef.current;
    if (!viewport || !restore) {
      return;
    }

    viewport.scrollTop = restore.scrollTop + (viewport.scrollHeight - restore.scrollHeight);
    restoreScrollAnchorRef.current = null;
  }, [visibleTimeline.hiddenCount, visibleTimeline.visibleItems.length]);

  const scrollToLatest = useStableEvent((behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior
    });
    shouldStickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setUnreadTimelineItems(0);
  });

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    const lastId = visibleTimeline.visibleItems.at(-1)?.id ?? null;
    const previous = lastVisibleTimelineSnapshotRef.current;

    if (!visibleTimeline.visibleItems.length) {
      lastVisibleTimelineSnapshotRef.current = {
        count: 0,
        lastId: null
      };
      return;
    }

    if (!viewport) {
      lastVisibleTimelineSnapshotRef.current = {
        count: visibleTimeline.visibleItems.length,
        lastId
      };
      return;
    }

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      window.requestAnimationFrame(() => scrollToLatest("auto"));
      lastVisibleTimelineSnapshotRef.current = {
        count: visibleTimeline.visibleItems.length,
        lastId
      };
      return;
    }

    if (skipNextTimelineReactionRef.current) {
      skipNextTimelineReactionRef.current = false;
      lastVisibleTimelineSnapshotRef.current = {
        count: visibleTimeline.visibleItems.length,
        lastId
      };
      return;
    }

    if (
      previous.count === visibleTimeline.visibleItems.length &&
      previous.lastId === lastId
    ) {
      return;
    }

    if (shouldStickToBottomRef.current) {
      window.requestAnimationFrame(() => scrollToLatest("auto"));
    } else {
      const delta = Math.max(1, visibleTimeline.visibleItems.length - previous.count);
      setUnreadTimelineItems((current) => current + delta);
      setShowJumpToLatest(true);
    }

    lastVisibleTimelineSnapshotRef.current = {
      count: visibleTimeline.visibleItems.length,
      lastId
    };
  }, [scrollToLatest, visibleTimeline.visibleItems]);

  const revealEarlierTimeline = useStableEvent(async () => {
    if (visibleTimeline.hiddenCount > 0) {
      captureScrollAnchor();
      setVisibleTimelineCount((current) => current + TIMELINE_EXPAND_BATCH);
      return;
    }

    if (!transcript?.next_cursor || isLoadingOlder) {
      return;
    }

    captureScrollAnchor();
    setIsLoadingOlder(true);
    setError(null);
    try {
      const olderPage = await getCodexMessagesPage({
        threadId,
        cursor: transcript.next_cursor,
        limit: 10
      });
      startTransition(() => {
        setTranscript((current) => {
          if (!current) {
            return olderPage;
          }
          return {
            ...current,
            thread: olderPage.thread,
            approvals: olderPage.approvals,
            patches: olderPage.patches,
            live_state: olderPage.live_state,
            items: mergeMessages(olderPage.items, current.items),
            next_cursor: olderPage.next_cursor,
            has_more: olderPage.has_more
          };
        });
        setLiveState(olderPage.live_state ?? null);
      });
    } catch (loadError) {
      setError(describeActionError(locale, loadError));
    } finally {
      setIsLoadingOlder(false);
    }
  });

  function handleTimelineScroll() {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    const distanceFromBottom =
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    shouldStickToBottomRef.current = nearBottom;

    if (nearBottom) {
      setShowJumpToLatest(false);
      setUnreadTimelineItems(0);
    } else {
      setShowJumpToLatest(true);
    }

    if (viewport.scrollTop <= SCROLL_TOP_THRESHOLD_PX) {
      void revealEarlierTimeline();
    }
  }

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    handleTimelineScroll();
  }, [visibleTimeline.visibleItems.length]);

  return {
    transcript,
    capabilities,
    sharedSettings,
    liveState,
    displayMessages,
    latestAssistantMessage,
    timelineItems: visibleTimeline.visibleItems,
    hiddenTimelineItemCount: visibleTimeline.hiddenCount,
    unreadTimelineItems,
    showJumpToLatest,
    scrollViewportRef,
    error,
    streamNotice,
    isLoading,
    isRefreshing,
    isLoadingOlder,
    transportState,
    eventActivity,
    setError,
    setStreamNotice,
    handleTimelineScroll,
    async refreshLatest() {
      await syncLatest(true);
    },
    async loadEarlierTimeline() {
      await revealEarlierTimeline();
    },
    scrollToLatest
  };
}
