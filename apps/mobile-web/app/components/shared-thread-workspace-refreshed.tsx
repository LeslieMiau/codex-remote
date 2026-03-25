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
import {
  getDisplayThreadTitle,
  shouldHideThreadFromMobileList
} from "../lib/chat-thread-presentation";
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
  translateApprovalKind,
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

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M6 12h.01M12 12h.01M18 12h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M4.75 6.75h14.5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m7.5 14 2.4-2.4a1.2 1.2 0 0 1 1.7 0L14 14l1.7-1.7a1.2 1.2 0 0 1 1.7 0L19 14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M9 10.25a1.1 1.1 0 1 0 0 .01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SkillsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M12 4.5v15M4.5 12h15M6.5 6.5l11 11M17.5 6.5l-11 11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="m6.5 12.5 3.5 3.5 7.5-8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
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
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
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
    setStreamNotice,
    isLoading,
    isLoadingOlder,
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
    ? `${transcript.thread.project_label} · ${formatTimestamp(locale, transcript.thread.updated_at)}`
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
        [...overview.threads]
          .filter((thread) => !shouldHideThreadFromMobileList(thread))
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
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
              aria-label={localize(locale, { zh: "更多操作", en: "More actions" })}
              className={styles.pageHeaderIconButton}
              onClick={() => setMobilePanel("details")}
              title={localize(locale, { zh: "更多", en: "More" })}
              type="button"
            >
              <MoreIcon />
            </button>
          </div>
        </header>

        {topStatus ? (
          <section
            className={[
              styles.noticeBar,
              styles.noticeBarDanger
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
            attachmentCount={selectedImages.length + selectedSkills.length}
            capabilitiesInterrupt={Boolean(capabilities?.interrupt)}
            composerDisabledReason={composerDisabledReason}
            composerInputDisabled={composerInputDisabled}
            composerRef={composerRef}
            hasAttachmentCapability={hasImageCapability || hasSkillCapability}
            imageInputRef={imageInputRef}
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
            onOpenAttachmentSheet={() => {
              setMobilePanel(null);
              setAttachmentSheetOpen(true);
            }}
            onOpenApprovalSheet={openApprovalSheet}
            onOpenNativeRequestSheet={openNativeRequestSheet}
            onOpenPatchReview={openPatchReview}
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
          variant="chat"
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
          <div className={styles.sheetList}>
            {isLoadingThreads ? (
              <p className={styles.sheetEmpty}>
                {localize(locale, { zh: "正在加载最近对话。", en: "Loading recent chats." })}
              </p>
            ) : switcherThreads.length === 0 ? (
              <p className={styles.sheetEmpty}>
                {localize(locale, { zh: "当前还没有别的对话。", en: "No other chats yet." })}
              </p>
            ) : (
              switcherThreads.map((thread) => (
                <button
                  key={thread.thread_id}
                  className={[
                    styles.sheetListButton,
                    thread.thread_id === threadId ? styles.sheetListButtonActive : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => handleThreadSelect(thread.thread_id)}
                  type="button"
                >
                  <div className={styles.sheetListButtonCopy}>
                    <strong>{getDisplayThreadTitle(locale, thread)}</strong>
                    <span>{thread.project_label}</span>
                  </div>
                  <div className={styles.sheetListButtonMeta}>
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
          eyebrow={localize(locale, { zh: "附件", en: "Attachments" })}
          fullHeight={false}
          open={attachmentSheetOpen}
          onClose={() => setAttachmentSheetOpen(false)}
          title={localize(locale, { zh: "添加附件", en: "Add attachment" })}
          variant="compact"
        >
          <div className={styles.sheetMenu}>
            {hasImageCapability ? (
              <button
                className={styles.sheetMenuButton}
                disabled={isMutating || isUploadingImages}
                onClick={() => {
                  setAttachmentSheetOpen(false);
                  imageInputRef.current?.click();
                }}
                type="button"
              >
                <span className={styles.sheetMenuIcon}>
                  <ImageIcon />
                </span>
                <span className={styles.sheetMenuCopy}>
                  <strong>{localize(locale, { zh: "图片", en: "Image" })}</strong>
                  <span className={styles.sheetMenuHint}>
                    {localize(locale, { zh: "发送到当前聊天", en: "Send to this chat" })}
                  </span>
                </span>
              </button>
            ) : null}

            {hasSkillCapability ? (
              <button
                className={styles.sheetMenuButton}
                disabled={isMutating || isLoadingSkills}
                onClick={() => {
                  setAttachmentSheetOpen(false);
                  setSkillSheetOpen(true);
                }}
                type="button"
              >
                <span className={styles.sheetMenuIcon}>
                  <SkillsIcon />
                </span>
                <span className={styles.sheetMenuCopy}>
                  <strong>{localize(locale, { zh: "技能", en: "Skills" })}</strong>
                  <span className={styles.sheetMenuHint}>
                    {selectedSkills.length > 0
                      ? localize(locale, {
                          zh: `已选 ${selectedSkills.length} 项`,
                          en: `${selectedSkills.length} selected`
                        })
                      : localize(locale, {
                          zh: "加入下一条消息",
                          en: "Add to the next message"
                        })}
                  </span>
                </span>
              </button>
            ) : null}
          </div>
        </MobileSheet>

        <MobileSheet
          eyebrow={localize(locale, { zh: "信息", en: "Info" })}
          fullHeight={false}
          open={mobilePanel === "details"}
          onClose={() => setMobilePanel(null)}
          title={localize(locale, { zh: "聊天信息", en: "Chat info" })}
          variant="chat"
        >
          <div className={styles.sheetStack}>
            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <strong>{localize(locale, { zh: "聊天设置", en: "Chat settings" })}</strong>
              </div>
              <div className={styles.sheetInfoList}>
                <div className={styles.sheetInfoRow}>
                  <span>{localize(locale, { zh: "模型", en: "Model" })}</span>
                  <strong>{selectedModelLabel ?? "-"}</strong>
                </div>
                <div className={styles.sheetInfoRow}>
                  <span>{localize(locale, { zh: "推理", en: "Reasoning" })}</span>
                  <strong>{sharedSettings?.model_reasoning_effort ?? "-"}</strong>
                </div>
                <div className={styles.sheetInfoRow}>
                  <span>{localize(locale, { zh: "工作区", en: "Workspace" })}</span>
                  <strong>{transcript?.thread.repo_root ?? "-"}</strong>
                </div>
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <strong>{localize(locale, { zh: "标题", en: "Title" })}</strong>
              </div>
              <div className={styles.sheetField}>
                <input
                  className={styles.sheetInput}
                  disabled={isMutating || !capabilities?.thread_rename}
                  onChange={(event) => setThreadTitleDraft(event.target.value)}
                  value={threadTitleDraft}
                />
                <div className={styles.sheetActionGrid}>
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
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <strong>{localize(locale, { zh: "聊天操作", en: "Thread actions" })}</strong>
              </div>
              <div className={styles.sheetActionGrid}>
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
              <div className={styles.sheetField}>
                <label className={styles.sheetLabel}>
                  <span>{localize(locale, { zh: "回滚轮数", en: "Rollback turns" })}</span>
                  <input
                    className={styles.sheetInput}
                    disabled={isMutating || !capabilities?.thread_rollback || remoteThreadActionsBlocked}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => setRollbackTurnsDraft(event.target.value)}
                    value={rollbackTurnsDraft}
                  />
                </label>
                <div className={styles.sheetActionGrid}>
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
                  <p className={styles.sheetNote}>
                    {localize(locale, {
                      zh: "这条聊天还在等待进入原生 Codex 时间线，归档、分支、review 和回滚等操作会在同步完成后开放。",
                      en: "This chat is still entering the native Codex timeline. Archive, fork, review, and rollback unlock after sync finishes."
                    })}
                  </p>
                ) : null}
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <strong>{localize(locale, { zh: "快捷操作", en: "Quick actions" })}</strong>
              </div>
              <div className={styles.sheetActionGrid}>
                <button
                  className="secondary-button"
                  onClick={() => void openThreadSwitcher()}
                  type="button"
                >
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
                  onClick={() => {
                    setMobilePanel(null);
                    setSkillSheetOpen(true);
                  }}
                  type="button"
                >
                  {localize(locale, { zh: "选择技能", en: "Pick skills" })}
                </button>
                <Link
                  className="chrome-button"
                  href={returnToListHref}
                  onClick={() => setMobilePanel(null)}
                >
                  {returnToListLabel}
                </Link>
              </div>
            </section>
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
          fullHeight={false}
          open={Boolean(confirmState)}
          onClose={() => setConfirmState(null)}
          title={
            confirmState?.kind === "interrupt"
              ? localize(locale, { zh: "停止当前运行？", en: "Stop the current run?" })
              : localize(locale, { zh: "拒绝这条批准请求？", en: "Reject this approval request?" })
          }
          variant="chat"
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
          variant="chat"
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
          open={skillSheetOpen}
          onClose={() => setSkillSheetOpen(false)}
          title={localize(locale, { zh: "技能", en: "Skills" })}
          variant="compact"
        >
          <div className={styles.sheetList}>
            {skillsError ? <p className={styles.sheetEmpty}>{skillsError}</p> : null}
            {isLoadingSkills ? (
              <p className={styles.sheetEmpty}>
                {localize(locale, { zh: "正在加载技能列表。", en: "Loading skills." })}
              </p>
            ) : availableSkills.length === 0 ? (
              <p className={styles.sheetEmpty}>
                {localize(locale, {
                  zh: "当前线程没有可用技能，或这个 Codex 版本还没有暴露技能列表。",
                  en: "No skills are available for this thread, or this Codex build does not expose a skills list."
                })}
              </p>
            ) : (
              availableSkills.map((skill) => {
                const selected = selectedSkills.some((candidate) => candidate.path === skill.path);
                return (
                  <button
                    key={skill.path}
                    className={[
                      styles.sheetListButton,
                      selected ? styles.sheetListButtonActive : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => toggleSelectedSkill(skill)}
                    type="button"
                  >
                    <span className={styles.sheetMenuIcon}>
                      <SkillsIcon />
                    </span>
                    <span className={styles.sheetListButtonCopy}>
                      <strong>{skill.display_name ?? skill.name}</strong>
                      <span>{skill.description ?? skill.path}</span>
                    </span>
                    <span className={styles.sheetCheck}>
                      {selected ? <CheckIcon /> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </MobileSheet>

        <MobileSheet
          eyebrow={localize(locale, { zh: "图片", en: "Image" })}
          fullHeight={false}
          open={Boolean(lightboxImageUrl)}
          onClose={() => setLightboxImageUrl(null)}
          title={localize(locale, { zh: "图片预览", en: "Image preview" })}
          variant="compact"
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
          variant="chat"
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
