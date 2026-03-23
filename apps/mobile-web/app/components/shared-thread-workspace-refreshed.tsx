"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CodexCapabilitiesResponse,
  CodexMessage,
  NativeRequestRecord,
  CodexThread,
  ApprovalRequest
} from "@codex-remote/protocol";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type SetStateAction
} from "react";

import { ChatComposer } from "./chat-composer";
import { ChatTimeline } from "./chat-timeline";
import { useKeyboardViewportState } from "./mobile-viewport";
import { MobileSheet } from "./mobile-sheet";
import styles from "./shared-thread-workspace-refreshed.module.css";
import { getCachedTranscript } from "../lib/client-cache";
import { getDisplayThreadTitle } from "../lib/chat-thread-presentation";
import {
  buildThreadPatchPath,
  buildThreadPath
} from "../lib/codex-paths";
import {
  archiveSharedThread,
  compactSharedThread,
  forkSharedThread,
  followUpRun,
  getCodexOverview,
  getThreadSkills,
  interruptSharedRun,
  renameSharedThread,
  resolveApproval,
  respondNativeRequest,
  rollbackSharedThread,
  startSharedReview,
  startSharedRun,
  unarchiveSharedThread,
  uploadSharedThreadImage
} from "../lib/gateway-client";
import {
  consumeThreadFlashMessage,
  writeThreadFlashMessage
} from "../lib/flash-message";
import {
  formatDateTime,
  localize,
  transportLabel,
  translateApprovalKind,
  translateThreadState,
  useLocale
} from "../lib/locale";
import {
  describeNativeRequestRecoveryNotice,
  describeNativeRequestTaskDetail
} from "../lib/native-input-copy";
import {
  beginPendingSend,
  clearPendingSend,
  editPendingSend,
  markPendingSendFailed,
  retryPendingSend,
  type PendingSendImage,
  type PendingSendSkill,
  type PendingSendState
} from "../lib/pending-send";
import {
  getStoredThreadListRoute,
  type ThreadListRoute
} from "../lib/thread-list-route-storage";
import { setStoredLastActiveThread } from "../lib/thread-storage";
import {
  describeActionError,
  type LiveActivity,
  useThreadRealtimeState
} from "../lib/thread-realtime-state";

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

interface NativeRequestQuestionOption {
  description?: string;
  label: string;
  value: string;
}

interface NativeRequestQuestion {
  id: string;
  options: NativeRequestQuestionOption[];
  question: string;
}

function translateNativeRequestKind(
  locale: "zh" | "en",
  kind: NativeRequestRecord["kind"]
) {
  switch (kind) {
    case "dynamic_tool":
      return localize(locale, { zh: "动态工具", en: "Dynamic tool" });
    case "auth_refresh":
      return localize(locale, { zh: "认证刷新", en: "Auth refresh" });
    default:
      return localize(locale, { zh: "补充输入", en: "Extra input" });
  }
}

function parseNativeRequestQuestions(request: NativeRequestRecord | null | undefined) {
  if (!request?.payload || typeof request.payload !== "object") {
    return [];
  }

  const rawQuestions = Array.isArray((request.payload as { questions?: unknown[] }).questions)
    ? ((request.payload as { questions: unknown[] }).questions ?? [])
    : [];

  const questions: NativeRequestQuestion[] = [];

  for (const candidate of rawQuestions) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const question = typeof record.question === "string" ? record.question : "";
    if (!id || !question) {
      continue;
    }

    const options: NativeRequestQuestionOption[] = [];
    if (Array.isArray(record.options)) {
      for (const option of record.options) {
        if (!option || typeof option !== "object") {
          continue;
        }

        const optionRecord = option as Record<string, unknown>;
        const label =
          typeof optionRecord.label === "string"
            ? optionRecord.label
            : typeof optionRecord.value === "string"
              ? optionRecord.value
              : "";
        if (!label) {
          continue;
        }

        options.push({
          label,
          value: typeof optionRecord.value === "string" ? optionRecord.value : label,
          description:
            typeof optionRecord.description === "string"
              ? optionRecord.description
              : undefined
        });
      }
    }

    questions.push({
      id,
      question,
      options
    });
  }

  return questions;
}

function buildUserInputResponsePayload(
  questions: NativeRequestQuestion[],
  answers: Record<string, string>
) {
  const nextAnswers: Record<string, { answers: string[] }> = {};
  for (const question of questions) {
    nextAnswers[question.id] = {
      answers: [answers[question.id] ?? ""]
    };
  }

  return {
    answers: nextAnswers
  };
}

function buildSelectedInputItems(
  images: PendingSendImage[],
  skills: PendingSendSkill[]
) {
  return [
    ...skills.map((skill) => ({
      type: "skill" as const,
      name: skill.name,
      path: skill.path
    })),
    ...images
      .filter((image) => typeof image.attachment_id === "string" && image.attachment_id.length > 0)
      .map((image) => ({
        type: "image_attachment" as const,
        attachment_id: image.attachment_id!,
        file_name: image.file_name
      }))
  ];
}

function injectSkillMentions(prompt: string, skills: PendingSendSkill[]) {
  const markers = skills
    .map((skill) => `$${skill.name}`)
    .filter((marker) => !prompt.includes(marker));
  if (markers.length === 0) {
    return prompt;
  }

  return `${markers.join(" ")}\n${prompt}`;
}

function getRepoTail(repoRoot: string) {
  const parts = repoRoot.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? repoRoot;
}

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
  state: CodexThread["sync_state"] | undefined
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

function summarizeMessageBody(locale: "zh" | "en", message: CodexMessage | null) {
  if (!message) {
    return localize(locale, {
      zh: "最新回复会显示在这里。",
      en: "The latest reply will appear here."
    });
  }

  const body = message.body?.trim() || message.title || "";
  if (!body) {
    return localize(locale, {
      zh: "Codex 正在准备新的回复。",
      en: "Codex is preparing a new reply."
    });
  }

  return body.length > 120 ? `${body.slice(0, 117)}...` : body;
}

function deriveLiveActivity(
  locale: "zh" | "en",
  transcript: ReturnType<typeof getCachedTranscript>,
  transportState: "idle" | "sse" | "websocket",
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
        zh: "最近一条消息尚未进入原生 Codex 时间线。",
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

  const pendingNativeRequests = transcript.native_requests.filter(
    (nativeRequest) => nativeRequest.status === "requested"
  );
  const pendingApprovals = transcript.approvals.filter(
    (approval) => approval.status === "requested"
  );
  const pendingPatches = transcript.patches.filter(
    (patch) => patch.status !== "applied" && patch.status !== "discarded"
  );

  if (pendingNativeRequests.length > 0) {
    return {
      title: localize(locale, { zh: "等待输入", en: "Waiting for input" }),
      detail:
        pendingNativeRequests[0]?.prompt ??
        localize(locale, {
          zh: "Codex 需要你补充输入后再继续。",
          en: "Codex needs extra input before moving on."
        }),
      tone: "warning" as const
    };
  }

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
      zh: "默认只显示最近对话内容，更早历史会在向上滚动时按需加载。",
      en: "Only recent conversation items are shown first. Earlier history loads as you scroll up."
    }),
    tone: "success" as const
  };
}

function revokePreviewUrl(value?: string) {
  if (!value || typeof URL === "undefined" || !value.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(value);
}

function revokeImagePreviews(images: PendingSendImage[]) {
  for (const image of images) {
    revokePreviewUrl(image.preview_url);
  }
}

function revokePendingSendPreviews(pendingSends: PendingSendState[]) {
  for (const pendingSend of pendingSends) {
    revokeImagePreviews(pendingSend.images);
  }
}

export function SharedThreadWorkspace({ threadId }: SharedThreadWorkspaceProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const { keyboardOffset } = useKeyboardViewportState();
  const isZh = locale === "zh";
  const [prompt, setPrompt] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [approvalSheetOpen, setApprovalSheetOpen] = useState(false);
  const [nativeRequestSheetOpen, setNativeRequestSheetOpen] = useState(false);
  const [dismissedApprovalId, setDismissedApprovalId] = useState<string | null>(null);
  const [dismissedNativeRequestId, setDismissedNativeRequestId] = useState<string | null>(null);
  const [nativeRequestAnswers, setNativeRequestAnswers] = useState<Record<string, string>>({});
  const [availableSkills, setAvailableSkills] = useState<PendingSendSkill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<PendingSendSkill[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillSheetOpen, setSkillSheetOpen] = useState(false);
  const [selectedImages, setSelectedImages] = useState<PendingSendImage[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [rollbackTurnsDraft, setRollbackTurnsDraft] = useState("1");
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [switcherThreads, setSwitcherThreads] = useState<CodexThread[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [threadSwitcherError, setThreadSwitcherError] = useState<string | null>(null);
  const [returnToListHref, setReturnToListHref] = useState<ThreadListRoute>("/projects");
  const [pendingSendsState, setPendingSendsState] = useState<PendingSendState[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const selectedImagesRef = useRef<PendingSendImage[]>([]);
  const pendingSendsRef = useRef<PendingSendState[]>([]);
  const preservedPendingSendPreviewIdsRef = useRef<Set<string>>(new Set());
  const previousSyncStateRef = useRef<CodexThread["sync_state"] | undefined>(
    getCachedTranscript(threadId)?.thread.sync_state
  );
  const previousRemoteActionsBlockedRef = useRef(
    Boolean(
      getCachedTranscript(threadId) &&
        (!getCachedTranscript(threadId)?.thread.adapter_thread_ref ||
          getCachedTranscript(threadId)?.thread.sync_state === "sync_pending")
    )
  );

  function setPendingSends(
    value: SetStateAction<PendingSendState[]>
  ) {
    setPendingSendsState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      const nextIds = new Set(next.map((entry) => entry.local_id));
      for (const entry of current) {
        if (nextIds.has(entry.local_id)) {
          continue;
        }
        if (!preservedPendingSendPreviewIdsRef.current.has(entry.local_id)) {
          revokeImagePreviews(entry.images);
        }
        preservedPendingSendPreviewIdsRef.current.delete(entry.local_id);
      }
      pendingSendsRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  useEffect(() => {
    pendingSendsRef.current = pendingSendsState;
  }, [pendingSendsState]);

  useEffect(() => {
    return () => {
      revokeImagePreviews(selectedImagesRef.current);
      revokePendingSendPreviews(pendingSendsRef.current);
    };
  }, []);

  const realtime = useThreadRealtimeState({
    threadId,
    locale,
    pendingSends: pendingSendsState,
    setPendingSends,
    onToast(message) {
      setToastMessage(message);
    }
  });

  const {
    transcript,
    capabilities,
    sharedSettings,
    timelineItems,
    hiddenTimelineItemCount,
    unreadTimelineItems,
    scrollViewportRef,
    error,
    setError,
    streamNotice,
    setStreamNotice,
    isLoading,
    isRefreshing,
    isLoadingOlder,
    transportState,
    eventActivity,
    showJumpToLatest,
    handleTimelineScroll,
    refreshLatest,
    scrollToLatest
  } = realtime;

  useEffect(() => {
    setStoredLastActiveThread(threadId);
  }, [threadId]);

  useEffect(() => {
    setReturnToListHref(getStoredThreadListRoute());
  }, [threadId]);

  useEffect(() => {
    revokeImagePreviews(selectedImagesRef.current);
    revokePendingSendPreviews(pendingSendsRef.current);
    setPrompt("");
    setToastMessage(null);
    setMobilePanel(null);
    setConfirmState(null);
    setApprovalSheetOpen(false);
    setNativeRequestSheetOpen(false);
    setDismissedApprovalId(null);
    setDismissedNativeRequestId(null);
    setNativeRequestAnswers({});
    setSelectedSkills([]);
    setSelectedImages([]);
    setSkillsError(null);
    setSkillSheetOpen(false);
    setThreadTitleDraft(getCachedTranscript(threadId)?.thread.title ?? "");
    setRollbackTurnsDraft("1");
    setLightboxImageUrl(null);
    setThreadSwitcherError(null);
    preservedPendingSendPreviewIdsRef.current.clear();
    pendingSendsRef.current = [];
    setPendingSendsState([]);
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;

    const loadSkills = async () => {
      setIsLoadingSkills(true);
      try {
        const nextSkills = await getThreadSkills(threadId);
        if (!cancelled) {
          setAvailableSkills(
            nextSkills.map((skill) => ({
              name: skill.name,
              path: skill.path,
              description: skill.description,
              display_name: skill.display_name
            }))
          );
          setSkillsError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setAvailableSkills([]);
          setSkillsError(describeActionError(locale, loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSkills(false);
        }
      }
    };

    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, [locale, threadId]);

  useEffect(() => {
    setThreadTitleDraft(transcript?.thread.title ?? "");
  }, [transcript?.thread.title]);

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

    const timeout = window.setTimeout(() => setToastMessage(null), 4_000);
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
  const pendingNativeRequests = useMemo(
    () => transcript?.native_requests.filter((request) => request.status === "requested") ?? [],
    [transcript]
  );
  const pendingPatches = useMemo(
    () =>
      transcript?.patches.filter(
        (patch) => patch.status !== "applied" && patch.status !== "discarded"
      ) ?? [],
    [transcript]
  );
  const pendingApprovalsById = useMemo(
    () => new Map(pendingApprovals.map((approval) => [approval.approval_id, approval])),
    [pendingApprovals]
  );
  const leadNativeRequest = pendingNativeRequests[0] ?? null;
  const leadApproval = pendingApprovals[0] ?? null;
  const leadPatch = pendingPatches[0] ?? null;
  const nativeRequestQuestions = useMemo(
    () => parseNativeRequestQuestions(leadNativeRequest),
    [leadNativeRequest]
  );
  const activeRunId = transcript?.thread.active_turn_id ?? null;
  const isRunActive =
    Boolean(activeRunId) &&
    (transcript?.thread.state === "running" ||
      transcript?.thread.state === "waiting_approval" ||
      transcript?.thread.state === "waiting_input");
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
        : pendingNativeRequests.length > 0
          ? localize(locale, {
              zh: "先处理补充输入请求，再继续发新消息。",
              en: "Resolve the input request before sending a new message."
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
              : selectedImages.some((image) => image.status === "uploading")
                ? localize(locale, {
                    zh: "图片上传完成后才能继续发送。",
                    en: "Wait for image uploads to finish before sending."
                  })
                : selectedImages.some((image) => image.status === "failed")
                  ? localize(locale, {
                      zh: "请移除上传失败的图片，或重新选择后再发送。",
                      en: "Remove the failed image upload or try again before sending."
                    })
                  : isRunActive && !capabilities?.live_follow_up
                    ? localize(locale, {
                        zh: "当前 Codex 版本暂不支持运行中追加指令。",
                        en: "Live follow-up unavailable on this Codex build."
                      })
                    : null;
  const composerInputDisabled = !transcript || transcript.thread.archived || isMutating;
  const liveActivity = deriveLiveActivity(locale, transcript, transportState, eventActivity);
  const syncStateLabel = translateSyncState(locale, transcript?.thread.sync_state);
  const remoteThreadActionsBlocked = Boolean(
    transcript &&
      (!transcript.thread.adapter_thread_ref || transcript.thread.sync_state === "sync_pending")
  );
  const returnToListLabel =
    returnToListHref === "/queue"
      ? localize(locale, { zh: "返回收件箱", en: "Back to inbox" })
      : localize(locale, { zh: "打开聊天列表", en: "Open chats" });
  const selectedModelLabel =
    sharedSettings?.available_models.find((option) => option.slug === sharedSettings.model)
      ?.display_name ?? sharedSettings?.model ?? null;
  const hasImageCapability = Boolean(capabilities?.supports_images && capabilities?.image_inputs);
  const hasSkillCapability = Boolean(capabilities?.skills_input);
  const displayThreadTitle = getDisplayThreadTitle(locale, transcript?.thread);
  const headerSubtitle = transcript
    ? `${translateThreadState(locale, transcript.thread.state)} · ${formatTimestamp(
        locale,
        transcript.thread.updated_at
      )}`
    : localize(locale, {
        zh: "正在连接聊天",
        en: "Connecting"
      });
  const topStatus = error
    ? {
        detail: error,
        title: localize(locale, { zh: "当前状态异常", en: "Something needs attention" }),
        tone: "danger" as const
      }
    : streamNotice
      ? {
        detail: streamNotice,
        title: localize(locale, { zh: "正在使用降级同步", en: "Using fallback sync" }),
        tone: "warning" as const
      }
      : transportState === "idle" && transcript && !isLoading
        ? {
            detail: localize(locale, {
              zh: "实时流暂时不可用，界面会继续自动同步。",
              en: "Live streaming is temporarily unavailable. The view will keep syncing."
            }),
            title: localize(locale, { zh: "正在重连", en: "Reconnecting" }),
            tone: "warning" as const
          }
        : transcript?.thread.sync_state === "sync_pending"
          ? {
              detail: localize(locale, {
                zh: "最新消息已发出，等待进入原生时间线。",
                en: "The latest message was sent and is waiting to enter the native timeline."
              }),
              title: localize(locale, { zh: "等待同步", en: "Waiting for sync" }),
              tone: "warning" as const
            }
          : pendingSendsState.some((entry) => entry.status === "sending")
            ? {
                detail: localize(locale, {
                  zh: "消息正在发送，确认后会进入正式会话记录。",
                  en: "The message is sending and will appear in the official transcript after confirmation."
                }),
                title: localize(locale, { zh: "发送中", en: "Sending" }),
                tone: "warning" as const
              }
            : null;

  useEffect(() => {
    if (!transcript) {
      previousSyncStateRef.current = undefined;
      previousRemoteActionsBlockedRef.current = false;
      return;
    }

    const previousSyncState = previousSyncStateRef.current;
    const previousRemoteActionsBlocked = previousRemoteActionsBlockedRef.current;

    if (
      previousRemoteActionsBlocked &&
      !remoteThreadActionsBlocked &&
      previousSyncState === "sync_pending" &&
      transcript.thread.sync_state === "native_confirmed"
    ) {
      setToastMessage(
        localize(locale, {
          zh: "原生同步已完成，现在可以继续归档、分支、Review 和回滚操作了。",
          en: "Native sync finished. Archive, fork, review, and rollback actions are available again."
        })
      );
    }

    previousSyncStateRef.current = transcript.thread.sync_state;
    previousRemoteActionsBlockedRef.current = remoteThreadActionsBlocked;
  }, [locale, remoteThreadActionsBlocked, transcript]);

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

  useEffect(() => {
    if (!leadNativeRequest) {
      setNativeRequestSheetOpen(false);
      setDismissedNativeRequestId(null);
      setNativeRequestAnswers({});
      return;
    }

    if (leadNativeRequest.native_request_id !== dismissedNativeRequestId) {
      setNativeRequestSheetOpen(true);
    }
  }, [dismissedNativeRequestId, leadNativeRequest]);

  useEffect(() => {
    if (!leadNativeRequest) {
      setNativeRequestAnswers({});
      return;
    }

    const questions = parseNativeRequestQuestions(leadNativeRequest);
    setNativeRequestAnswers((current) => {
      const next: Record<string, string> = {};
      for (const question of questions) {
        next[question.id] = current[question.id] ?? question.options[0]?.value ?? "";
      }
      return next;
    });
  }, [leadNativeRequest]);

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

  function toggleSelectedSkill(skill: PendingSendSkill) {
    setSelectedSkills((current) => {
      const exists = current.some((candidate) => candidate.path === skill.path);
      if (exists) {
        return current.filter((candidate) => candidate.path !== skill.path);
      }
      return [...current, skill];
    });
  }

  function removeSelectedImage(localId: string) {
    setSelectedImages((current) => {
      const next = current.filter((image) => image.local_id !== localId);
      const removed = current.find((image) => image.local_id === localId);
      if (removed) {
        revokePreviewUrl(removed.preview_url);
      }
      return next;
    });
  }

  async function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setIsUploadingImages(true);
    setError(null);

    for (const file of files) {
      const localId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${file.name}`;
      const previewUrl = URL.createObjectURL(file);

      setSelectedImages((current) => [
        ...current,
        {
          local_id: localId,
          file_name: file.name,
          content_type: file.type,
          preview_url: previewUrl,
          status: "uploading"
        }
      ]);

      try {
        const uploaded = await uploadSharedThreadImage(threadId, file);
        setSelectedImages((current) =>
          current.map((image) =>
            image.local_id === localId
              ? {
                  ...image,
                  id: uploaded.attachment_id,
                  attachment_id: uploaded.attachment_id,
                  status: "ready"
                }
              : image
          )
        );
      } catch (uploadError) {
        const message = describeActionError(locale, uploadError);
        setSelectedImages((current) =>
          current.map((image) =>
            image.local_id === localId
              ? {
                  ...image,
                  status: "failed",
                  error: message
                }
              : image
          )
        );
        setError(message);
      }
    }

    setIsUploadingImages(false);
  }

  async function openThreadSwitcher() {
    setMobilePanel("threads");
    setThreadSwitcherError(null);
    setIsLoadingThreads(true);
    try {
      const overview = await getCodexOverview({
        includeArchived: true
      });
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
    router.push(buildThreadPath(nextThreadId));
  }

  async function handleRenameThread() {
    if (!transcript) {
      return;
    }

    const nextTitle = threadTitleDraft.trim();
    if (!nextTitle || nextTitle === transcript.thread.title) {
      return;
    }

    await runMutation(async () => {
      await renameSharedThread(threadId, nextTitle);
    }, localize(locale, {
      zh: "聊天标题已更新。",
      en: "The chat title was updated."
    }));
  }

  async function handleArchiveToggle() {
    if (!transcript) {
      return;
    }

    await runMutation(async () => {
      if (transcript.thread.archived) {
        await unarchiveSharedThread(threadId);
      } else {
        await archiveSharedThread(threadId);
      }
    }, transcript.thread.archived
      ? localize(locale, {
          zh: "聊天已取消归档。",
          en: "The chat was restored from archive."
        })
      : localize(locale, {
          zh: "聊天已归档。",
          en: "The chat was archived."
        }));
  }

  async function handleCompactThread() {
    await runMutation(async () => {
      await compactSharedThread(threadId);
    }, localize(locale, {
      zh: "聊天已请求压缩。",
      en: "The chat was queued for compaction."
    }));
  }

  async function handleForkThread() {
    setIsMutating(true);
    setError(null);

    try {
      const forked = await forkSharedThread(threadId);
      const nextThreadId = forked.thread.thread_id;
      writeThreadFlashMessage({
        threadId: nextThreadId,
        message: localize(locale, {
          zh: "已基于当前聊天创建分支。",
          en: "A forked chat was created from this thread."
        })
      });
      setStoredLastActiveThread(nextThreadId);
      router.push(buildThreadPath(nextThreadId));
    } catch (actionError) {
      setError(describeActionError(locale, actionError));
    } finally {
      setIsMutating(false);
    }
  }

  async function handleRollbackThread() {
    const numTurns = Number.parseInt(rollbackTurnsDraft, 10);
    if (!Number.isFinite(numTurns) || numTurns <= 0) {
      setError(
        localize(locale, {
          zh: "请输入大于 0 的回滚轮数。",
          en: "Enter a rollback depth greater than 0."
        })
      );
      return;
    }

    await runMutation(async () => {
      await rollbackSharedThread(threadId, numTurns);
    }, localize(locale, {
      zh: "聊天已回滚到更早状态。",
      en: "The chat was rolled back."
    }));
  }

  async function handleStartReview() {
    setIsMutating(true);
    setError(null);

    try {
      const started = await startSharedReview({
        thread_id: threadId,
        target: {
          type: "uncommittedChanges"
        }
      });
      writeThreadFlashMessage({
        threadId: started.review_thread_id,
        message: localize(locale, {
          zh: "已为当前工作区创建 review 线程。",
          en: "A review thread was started for this workspace."
        })
      });
      setStoredLastActiveThread(started.review_thread_id);
      router.push(buildThreadPath(started.review_thread_id));
    } catch (actionError) {
      setError(describeActionError(locale, actionError));
    } finally {
      setIsMutating(false);
    }
  }

  function openPatchReview(patchId: string) {
    setMobilePanel(null);
    router.push(buildThreadPatchPath(threadId, patchId));
  }

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

  function openNativeRequestSheet() {
    setDismissedNativeRequestId(null);
    setMobilePanel(null);
    setNativeRequestSheetOpen(true);
  }

  function closeNativeRequestSheet() {
    if (leadNativeRequest) {
      setDismissedNativeRequestId(leadNativeRequest.native_request_id);
    }
    setNativeRequestSheetOpen(false);
  }

  async function handleNativeRequestAction(action: "respond" | "cancel") {
    if (!leadNativeRequest) {
      return;
    }

    const responsePayload =
      action === "respond" && leadNativeRequest.kind === "user_input"
        ? buildUserInputResponsePayload(nativeRequestQuestions, nativeRequestAnswers)
        : undefined;

    await runMutation(async () => {
      await respondNativeRequest({
        nativeRequestId: leadNativeRequest.native_request_id,
        action,
        responsePayload
      });
      setNativeRequestSheetOpen(false);
    }, action === "cancel"
      ? localize(locale, {
          zh: "这条补充输入请求已取消。",
          en: "The input request was canceled."
        })
      : localize(locale, {
          zh: "补充输入已提交给 Codex。",
          en: "The requested input was sent back to Codex."
        }));
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
      ? pendingSendsState.find((entry) => entry.local_id === options.pendingLocalId) ?? null
      : null;
    if (options?.pendingLocalId && !existingPending) {
      return;
    }

    const nextImages = existingPending?.images ?? selectedImages;
    const nextSkills = existingPending?.skills ?? selectedSkills;
    const inputItems = buildSelectedInputItems(nextImages, nextSkills);
    const promptWithSkills = injectSkillMentions(trimmedPrompt, nextSkills);
    const pendingSend =
      existingPending ??
      beginPendingSend({
        local_id: options?.pendingLocalId,
        body: trimmedPrompt,
        prompt: trimmedPrompt,
        input_items: inputItems,
        images: nextImages,
        skills: nextSkills
      });

    setPendingSends((current) =>
      options?.pendingLocalId
        ? retryPendingSend(current, options.pendingLocalId)
        : [...current, pendingSend]
    );
    setToastMessage(null);
    if (!options?.pendingLocalId) {
      setPrompt("");
      setSelectedImages([]);
      setSelectedSkills([]);
    }
    setIsMutating(true);
    setError(null);
    setStreamNotice(null);

    try {
      if (isRunActive && capabilities?.live_follow_up && activeRunId) {
        await followUpRun(activeRunId, promptWithSkills, inputItems);
      } else {
        await startSharedRun(threadId, promptWithSkills, inputItems);
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
    const target = pendingSendsState.find((entry) => entry.local_id === localId);
    if (!target) {
      return;
    }

    void submitPrompt(target.prompt, {
      pendingLocalId: localId
    });
  }

  function handleEditPendingSend(localId: string) {
    const nextState = editPendingSend(pendingSendsState, localId, prompt);
    preservedPendingSendPreviewIdsRef.current.add(localId);
    revokeImagePreviews(selectedImagesRef.current);
    setPendingSends(nextState.pendingSends);
    setPrompt(nextState.prompt);
    setSelectedImages(nextState.images);
    setSelectedSkills(nextState.skills);
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

  function handleInterrupt() {
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
    <div
      className={styles.chatShell}
      style={
        {
          "--keyboard-offset": `${keyboardOffset}px`
        } as CSSProperties
      }
    >
      <div className={styles.chatLayout}>
        {toastMessage ? (
          <div aria-live="polite" className="codex-toast" role="status">
            {toastMessage}
          </div>
        ) : null}

        <header className={styles.pageHeader}>
          <Link aria-label={returnToListLabel} className={styles.pageHeaderBack} href={returnToListHref}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M15 19l-7-7 7-7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
              />
            </svg>
          </Link>

          <div className={styles.pageHeaderCopy}>
            <h1>{displayThreadTitle}</h1>
            <p className={styles.pageHeaderSubtitle}>{headerSubtitle}</p>
          </div>

          <div className={styles.pageHeaderActions}>
            <button
              className="chrome-button"
              onClick={() => setMobilePanel("details")}
              type="button"
            >
              {localize(locale, { zh: "更多", en: "More" })}
            </button>
          </div>
        </header>

        {topStatus ? (
          <section
            className={[
              styles.noticeBar,
              topStatus.tone === "danger" ? styles.noticeBarDanger : "",
              topStatus.tone === "warning" ? styles.noticeBarWarning : ""
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className={styles.noticeCopy}>
              <strong>{topStatus.title}</strong>
              <p>{topStatus.detail}</p>
            </div>
          </section>
        ) : null}

        <section className={styles.conversationCard}>
          <div
            className={styles.timelineViewport}
            onScroll={handleTimelineScroll}
            ref={scrollViewportRef}
          >
            <div className={styles.timelineInner}>
              <ChatTimeline
                hasMoreRemoteHistory={Boolean(transcript?.has_more)}
                hiddenItemCount={hiddenTimelineItemCount}
                isLoading={isLoading}
                isLoadingOlder={isLoadingOlder}
                locale={locale}
                onDismissPendingSend={handleDismissPendingSend}
                onEditPendingSend={handleEditPendingSend}
                onOpenPatchReview={openPatchReview}
                onRetryPendingSend={handleRetryPendingSend}
                pendingApprovalsById={pendingApprovalsById as Map<string, ApprovalRequest>}
                timelineItems={timelineItems}
              />
            </div>
          </div>

          {showJumpToLatest ? (
            <button
              className={styles.jumpToLatest}
              onClick={() => scrollToLatest("smooth")}
              type="button"
            >
              {unreadTimelineItems > 0
                ? localize(locale, {
                    zh: `回到最新 · ${unreadTimelineItems}`,
                    en: `Latest · ${unreadTimelineItems}`
                  })
                : localize(locale, { zh: "回到最新", en: "Latest" })}
            </button>
          ) : null}

          <ChatComposer
            capabilitiesInterrupt={Boolean(capabilities?.interrupt)}
            composerDisabledReason={composerDisabledReason}
            composerInputDisabled={composerInputDisabled}
            composerRef={composerRef}
            hasImageCapability={hasImageCapability}
            hasSkillCapability={hasSkillCapability}
            imageInputRef={imageInputRef}
            isLoadingSkills={isLoadingSkills}
            isMutating={isMutating}
            isRunActive={isRunActive}
            isUploadingImages={isUploadingImages}
            leadApproval={leadApproval}
            leadNativeRequest={leadNativeRequest}
            leadPatch={leadPatch}
            locale={locale}
            onComposerKeyDown={handleComposerKeyDown}
            onImageSelection={(event) => void handleImageSelection(event)}
            onInterrupt={handleInterrupt}
            onOpenApprovalSheet={openApprovalSheet}
            onOpenNativeRequestSheet={openNativeRequestSheet}
            onOpenPatchReview={openPatchReview}
            onOpenSkillSheet={() => {
              setMobilePanel(null);
              setSkillSheetOpen(true);
            }}
            onPromptChange={setPrompt}
            onRemoveImage={removeSelectedImage}
            onRun={() => void handleRun()}
            onToggleSelectedSkill={toggleSelectedSkill}
            onViewImage={setLightboxImageUrl}
            pendingNativeRequestCount={pendingNativeRequests.length}
            prompt={prompt}
            selectedImages={selectedImages}
            selectedSkills={selectedSkills}
          />
        </section>

        <MobileSheet
          eyebrow={localize(locale, { zh: "聊天", en: "Chats" })}
          footer={
            <Link
              className="secondary-button"
              href={returnToListHref}
              onClick={() => setMobilePanel(null)}
            >
              {returnToListLabel}
            </Link>
          }
          open={mobilePanel === "threads"}
          onClose={() => setMobilePanel(null)}
          title={localize(locale, { zh: "切换对话", en: "Switch chats" })}
        >
          {threadSwitcherError ? (
            <section
              aria-live="assertive"
              className="codex-status-strip codex-status-strip--stacked tone-danger"
              role="alert"
            >
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
                    <span className="state-pill">{translateThreadState(locale, thread.state)}</span>
                    {thread.pending_approvals > 0 ? (
                      <span className="status-dot">
                        {isZh
                          ? `${thread.pending_approvals} 个待批准`
                          : `${thread.pending_approvals} approvals`}
                      </span>
                    ) : null}
                    {thread.pending_native_requests > 0 ? (
                      <span className="status-dot">
                        {isZh
                          ? `${thread.pending_native_requests} 个待输入`
                          : `${thread.pending_native_requests} inputs`}
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
                <div className="codex-side-row">
                  <span>{localize(locale, { zh: "工作区", en: "Workspace" })}</span>
                  <span>{transcript?.thread.repo_root ?? "-"}</span>
                </div>
              </div>
            </article>

            <article className="codex-side-item">
              <strong>{localize(locale, { zh: "标题", en: "Title" })}</strong>
              <div className="codex-page-stack">
                <input
                  className="chrome-input"
                  disabled={isMutating || !capabilities?.thread_rename}
                  onChange={(event) => setThreadTitleDraft(event.target.value)}
                  value={threadTitleDraft}
                />
                <div className="feed-actions">
                  <button
                    className="secondary-button"
                    disabled={
                      isMutating ||
                      !capabilities?.thread_rename ||
                      !threadTitleDraft.trim() ||
                      threadTitleDraft.trim() === transcript?.thread.title
                    }
                    onClick={() => void handleRenameThread()}
                    type="button"
                  >
                    {localize(locale, { zh: "更新标题", en: "Rename chat" })}
                  </button>
                </div>
              </div>
            </article>

            <article className="codex-side-item">
              <strong>{localize(locale, { zh: "聊天操作", en: "Thread actions" })}</strong>
              <div className="feed-actions">
                <button
                  className="secondary-button"
                  disabled={isMutating || !capabilities?.thread_archive || remoteThreadActionsBlocked}
                  onClick={() => void handleArchiveToggle()}
                  type="button"
                >
                  {transcript?.thread.archived
                    ? localize(locale, { zh: "取消归档", en: "Unarchive" })
                    : localize(locale, { zh: "归档", en: "Archive" })}
                </button>
                <button
                  className="secondary-button"
                  disabled={isMutating || !capabilities?.thread_compact || remoteThreadActionsBlocked}
                  onClick={() => void handleCompactThread()}
                  type="button"
                >
                  {localize(locale, { zh: "压缩上下文", en: "Compact" })}
                </button>
                <button
                  className="secondary-button"
                  disabled={isMutating || !capabilities?.thread_fork || remoteThreadActionsBlocked}
                  onClick={() => void handleForkThread()}
                  type="button"
                >
                  {localize(locale, { zh: "分支一条聊天", en: "Fork chat" })}
                </button>
                <button
                  className="secondary-button"
                  disabled={isMutating || !capabilities?.review_start || remoteThreadActionsBlocked}
                  onClick={() => void handleStartReview()}
                  type="button"
                >
                  {localize(locale, { zh: "开始 review", en: "Start review" })}
                </button>
              </div>
              <div className="codex-page-stack">
                <label className="codex-form-field">
                  <span>{localize(locale, { zh: "回滚轮数", en: "Rollback turns" })}</span>
                  <input
                    className="chrome-input"
                    disabled={isMutating || !capabilities?.thread_rollback || remoteThreadActionsBlocked}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => setRollbackTurnsDraft(event.target.value)}
                    value={rollbackTurnsDraft}
                  />
                </label>
                <div className="feed-actions">
                  <button
                    className="danger-button"
                    disabled={isMutating || !capabilities?.thread_rollback || remoteThreadActionsBlocked}
                    onClick={() => void handleRollbackThread()}
                    type="button"
                  >
                    {localize(locale, { zh: "回滚聊天", en: "Rollback chat" })}
                  </button>
                </div>
                {remoteThreadActionsBlocked ? (
                  <p className="codex-inline-note">
                    {localize(locale, {
                      zh: "这条聊天还在等待进入原生 Codex 时间线，归档、分支、review 和回滚等操作会在同步完成后自动开放。",
                      en: "This chat is still entering the native Codex timeline. Archive, fork, review, and rollback unlock automatically after sync finishes."
                    })}
                  </p>
                ) : null}
              </div>
            </article>

            <article className="codex-side-item">
              <strong>{localize(locale, { zh: "快捷操作", en: "Quick actions" })}</strong>
              <div className="feed-actions">
                <button className="secondary-button" onClick={() => void openThreadSwitcher()} type="button">
                  {localize(locale, { zh: "最近聊天", en: "Recent chats" })}
                </button>
                <button
                  className="secondary-button"
                  disabled={isMutating || isLoading}
                  onClick={() => void refreshLatest()}
                  type="button"
                >
                  {localize(locale, { zh: "刷新", en: "Refresh" })}
                </button>
                <button
                  className="secondary-button"
                  disabled={isMutating || !hasSkillCapability}
                  onClick={() => setSkillSheetOpen(true)}
                  type="button"
                >
                  {localize(locale, { zh: "选择技能", en: "Pick skills" })}
                </button>
                <Link className="chrome-button" href={returnToListHref} onClick={() => setMobilePanel(null)}>
                  {returnToListLabel}
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

        <MobileSheet
          eyebrow={localize(locale, { zh: "补充输入", en: "Extra input" })}
          footer={
            leadNativeRequest ? (
              <>
                <button
                  className="secondary-button"
                  disabled={isMutating}
                  onClick={() => void handleNativeRequestAction("cancel")}
                  type="button"
                >
                  {localize(locale, { zh: "取消请求", en: "Cancel request" })}
                </button>
                {leadNativeRequest.kind === "user_input" ? (
                  <button
                    className="primary-button"
                    disabled={
                      isMutating ||
                      nativeRequestQuestions.some(
                        (question) => !(nativeRequestAnswers[question.id] ?? "").trim()
                      )
                    }
                    onClick={() => void handleNativeRequestAction("respond")}
                    type="button"
                  >
                    {localize(locale, { zh: "提交输入", en: "Submit input" })}
                  </button>
                ) : null}
              </>
            ) : (
              <button className="secondary-button" onClick={closeNativeRequestSheet} type="button">
                {localize(locale, { zh: "关闭", en: "Close" })}
              </button>
            )
          }
          open={Boolean(leadNativeRequest) && nativeRequestSheetOpen}
          onClose={closeNativeRequestSheet}
          title={localize(locale, { zh: "处理补充输入", en: "Handle extra input" })}
        >
          {leadNativeRequest ? (
            <div className="codex-side-list">
              {leadNativeRequest.kind !== "user_input" ? (
                <section className="codex-status-strip codex-status-strip--stacked tone-warning">
                  <div className="codex-status-strip__copy">
                    <p className="section-label">{localize(locale, { zh: "恢复引导", en: "Recovery guidance" })}</p>
                    <strong>{describeNativeRequestRecoveryNotice(locale, leadNativeRequest.kind).title}</strong>
                    <p>{describeNativeRequestRecoveryNotice(locale, leadNativeRequest.kind).body}</p>
                  </div>
                </section>
              ) : null}

              <article className="codex-side-item">
                <p className="section-label">{localize(locale, { zh: "类型", en: "Kind" })}</p>
                <strong>{leadNativeRequest.title ?? translateNativeRequestKind(locale, leadNativeRequest.kind)}</strong>
                <p>
                  {leadNativeRequest.prompt ??
                    localize(locale, {
                      zh: "Codex 正在等待额外输入。",
                      en: "Codex is waiting for additional input."
                    })}
                </p>
                <div className="codex-page-card__meta">
                  <span className="status-dot">
                    {localize(locale, { zh: "请求于", en: "Requested" })}{" "}
                    {formatTimestamp(locale, leadNativeRequest.requested_at)}
                  </span>
                  {pendingNativeRequests.length > 1 ? (
                    <span className="status-dot">
                      {isZh
                        ? `还有 ${pendingNativeRequests.length - 1} 条待处理`
                        : `${pendingNativeRequests.length - 1} more waiting`}
                    </span>
                  ) : null}
                </div>
              </article>

              {leadNativeRequest.kind === "user_input" && nativeRequestQuestions.length > 0 ? (
                nativeRequestQuestions.map((question) => (
                  <article key={question.id} className="codex-side-item">
                    <strong>{question.question}</strong>
                    <div className="codex-page-stack">
                      {question.options.length > 0 ? (
                        <div className="feed-actions">
                          {question.options.map((option) => {
                            const selected = nativeRequestAnswers[question.id] === option.value;
                            return (
                              <button
                                key={option.value}
                                className={selected ? "primary-button" : "secondary-button"}
                                onClick={() =>
                                  setNativeRequestAnswers((current) => ({
                                    ...current,
                                    [question.id]: option.value
                                  }))
                                }
                                type="button"
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          className="chrome-input"
                          onChange={(event) =>
                            setNativeRequestAnswers((current) => ({
                              ...current,
                              [question.id]: event.target.value
                            }))
                          }
                          value={nativeRequestAnswers[question.id] ?? ""}
                        />
                      )}
                      {question.options.length > 0
                        ? question.options.find(
                            (option) => option.value === nativeRequestAnswers[question.id]
                          )?.description
                          ? (
                              <p className="codex-inline-note">
                                {
                                  question.options.find(
                                    (option) => option.value === nativeRequestAnswers[question.id]
                                  )?.description
                                }
                              </p>
                            )
                          : null
                        : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="codex-inline-note">
                  {describeNativeRequestTaskDetail(
                    locale,
                    leadNativeRequest.kind,
                    leadNativeRequest.prompt
                  )}
                </p>
              )}
            </div>
          ) : null}
        </MobileSheet>

        <MobileSheet
          eyebrow={localize(locale, { zh: "技能", en: "Skills" })}
          footer={
            <button className="secondary-button" onClick={() => setSkillSheetOpen(false)} type="button">
              {localize(locale, { zh: "完成", en: "Done" })}
            </button>
          }
          open={skillSheetOpen}
          onClose={() => setSkillSheetOpen(false)}
          title={localize(locale, { zh: "选择技能", en: "Pick skills" })}
        >
          <div className="codex-side-list">
            {skillsError ? <p className="codex-inline-note tone-danger">{skillsError}</p> : null}
            {isLoadingSkills ? (
              <p className="codex-inline-note">
                {localize(locale, { zh: "正在加载技能列表。", en: "Loading skills." })}
              </p>
            ) : availableSkills.length === 0 ? (
              <p className="codex-inline-note">
                {localize(locale, {
                  zh: "当前线程没有可用技能，或这个 Codex 版本还没有暴露技能列表。",
                  en: "No skills are available for this thread, or this Codex build does not expose a skills list."
                })}
              </p>
            ) : (
              availableSkills.map((skill) => {
                const selected = selectedSkills.some((candidate) => candidate.path === skill.path);
                return (
                  <article key={skill.path} className="codex-side-item">
                    <strong>{skill.display_name ?? skill.name}</strong>
                    <p>{skill.description ?? skill.path}</p>
                    <div className="feed-actions">
                      <button
                        className={selected ? "primary-button" : "secondary-button"}
                        onClick={() => toggleSelectedSkill(skill)}
                        type="button"
                      >
                        {selected
                          ? localize(locale, { zh: "已选择", en: "Selected" })
                          : localize(locale, { zh: "加入输入", en: "Add to prompt" })}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </MobileSheet>

        <MobileSheet
          eyebrow={localize(locale, { zh: "图片", en: "Image" })}
          footer={
            <button className="secondary-button" onClick={() => setLightboxImageUrl(null)} type="button">
              {localize(locale, { zh: "关闭", en: "Close" })}
            </button>
          }
          open={Boolean(lightboxImageUrl)}
          onClose={() => setLightboxImageUrl(null)}
          title={localize(locale, { zh: "图片预览", en: "Image preview" })}
        >
          {lightboxImageUrl ? (
            <div className={styles.lightbox}>
              <img
                alt={localize(locale, { zh: "图片预览", en: "Image preview" })}
                src={lightboxImageUrl}
              />
            </div>
          ) : null}
        </MobileSheet>

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
          open={Boolean(leadApproval) && approvalSheetOpen}
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
    </div>
  );
}

export default SharedThreadWorkspace;
