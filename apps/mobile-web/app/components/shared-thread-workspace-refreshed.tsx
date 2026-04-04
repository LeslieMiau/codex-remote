"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
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
import { SharedThreadApprovalActionList } from "./shared-thread-approval-action-list";
import {
  buildRecentChatsSheetCopy,
  describeThreadTimelineEmptyMessage
} from "./shared-empty-state-presentation";
import { useThreadAttachmentController } from "./shared-thread-attachment-controller";
import { buildSharedThreadDetailsViewModel } from "./shared-thread-details-view-model";
import { useSharedThreadSwitcherController } from "./shared-thread-switcher-controller";
import { ChatTimeline } from "./chat-timeline";
import { useKeyboardViewportState } from "./mobile-viewport";
import { MobileSheet } from "./mobile-sheet";
import {
  buildNativeUserInputResponsePayload,
  useThreadRequestSheetController
} from "./shared-thread-request-sheet-controller";
import {
  buildSharedThreadWorkspaceScreenModel,
  formatWorkspaceTimestamp,
  parseNativeRequestQuestions
} from "./shared-thread-workspace-screen-model";
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
  localize,
  translateApprovalKind,
  useLocale
} from "../lib/locale";
import {
  buildApprovalActionOptions,
  type ApprovalActionOption
} from "../lib/approval-actions";
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
      approved: boolean;
      confirmationBody: string;
      confirmationTitle: string;
      kind: "approval-action";
      label: string;
      nativeDecision?: unknown;
    }
  | null;

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
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [rollbackTurnsDraft, setRollbackTurnsDraft] = useState("1");
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
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
  const {
    addUploadingImage,
    attachmentSheetOpen,
    availableSkills,
    closeAttachmentSheet,
    closeSkillSheet,
    isLoadingSkills,
    isUploadingImages,
    markUploadedImageFailed,
    markUploadedImageReady,
    openAttachmentSheet,
    openSkillSheet,
    removeSelectedImage: removeSelectedImageState,
    reset: resetAttachments,
    selectedImages,
    selectedSkills,
    setAvailableSkills,
    setIsLoadingSkills,
    setIsUploadingImages,
    setSelectedImages,
    setSelectedSkills,
    setSkillsError,
    skillSheetOpen,
    skillsError,
    toggleSelectedSkill
  } = useThreadAttachmentController();

  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  useEffect(() => {
    setStoredLastActiveThread(threadId);
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

  const {
    isLoadingThreads,
    loadThreads: loadThreadSwitcher,
    returnToListHref,
    selectThread,
    switcherThreads,
    threadSwitcherError
  } = useSharedThreadSwitcherController({
    locale,
    onSelectThread(nextThreadId) {
      setMobilePanel(null);
      router.push(buildThreadPath(nextThreadId));
    },
    threadId
  });
  const recentChatsSheetCopy = useMemo(() => buildRecentChatsSheetCopy(locale), [locale]);

  const screenModel = useMemo(
    () =>
      buildSharedThreadWorkspaceScreenModel({
        transcript,
        capabilities,
        sharedSettings,
        locale,
        selectedImages,
        isMutating,
        error,
        returnToListHref
      }),
    [
      capabilities,
      error,
      isMutating,
      locale,
      returnToListHref,
      selectedImages,
      sharedSettings,
      transcript
    ]
  );
  const {
    activeRunId,
    composerDisabledReason,
    composerInputDisabled,
    displayThreadTitle,
    hasImageCapability,
    hasSkillCapability,
    headerSubtitle,
    isOfflineFallbackThread,
    isRunActive,
    leadApproval,
    leadNativeRequest,
    leadPatch,
    nativeRequestQuestions,
    pendingApprovals,
    pendingApprovalsById,
    pendingNativeRequests,
    pendingPatches,
    remoteThreadActionsBlocked,
    returnToListLabel,
    selectedModelLabel,
    topStatus
  } = screenModel;
  const {
    approvalSheetOpen,
    closeApprovalSheet: dismissApprovalSheetController,
    closeNativeRequestSheet: dismissNativeRequestSheetController,
    nativeRequestAnswers,
    nativeRequestSheetOpen,
    openApprovalSheet: openApprovalSheetController,
    openNativeRequestSheet: openNativeRequestSheetController,
    reset: resetRequestSheets,
    updateNativeRequestAnswers
  } = useThreadRequestSheetController({
    leadApproval,
    leadNativeRequest,
    nativeRequestQuestions
  });
  const detailsViewModel = useMemo(
    () =>
      buildSharedThreadDetailsViewModel({
        capabilities,
        hasSkillCapability,
        isLoading,
        isMutating,
        locale,
        remoteThreadActionsBlocked,
        selectedModelLabel,
        transcript
      }),
    [
      capabilities,
      hasSkillCapability,
      isLoading,
      isMutating,
      locale,
      remoteThreadActionsBlocked,
      selectedModelLabel,
      transcript
    ]
  );
  const approvalActions = useMemo(
    () => buildApprovalActionOptions(locale, leadApproval),
    [leadApproval, locale]
  );

  useEffect(() => {
    revokeImagePreviews(selectedImagesRef.current);
    revokePendingSendPreviews(pendingSendsRef.current);
    setPrompt("");
    setToastMessage(null);
    setMobilePanel(null);
    setConfirmState(null);
    resetRequestSheets();
    resetAttachments();
    setThreadTitleDraft(getCachedTranscript(threadId)?.thread.title ?? "");
    setRollbackTurnsDraft("1");
    setLightboxImageUrl(null);
    preservedPendingSendPreviewIdsRef.current.clear();
    pendingSendsRef.current = [];
    setPendingSendsState([]);
  }, [resetAttachments, resetRequestSheets, threadId]);

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

  function removeSelectedImage(localId: string) {
    const removed =
      selectedImages.find((image) => image.local_id === localId) ?? null;
    removeSelectedImageState(localId);
    if (removed) {
      revokePreviewUrl(removed.preview_url);
    }
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

      addUploadingImage({
        local_id: localId,
        file_name: file.name,
        content_type: file.type,
        preview_url: previewUrl,
        status: "uploading"
      });

      try {
        const uploaded = await uploadSharedThreadImage(threadId, file);
        markUploadedImageReady(localId, uploaded.attachment_id);
      } catch (uploadError) {
        const message = describeActionError(locale, uploadError);
        markUploadedImageFailed(localId, message);
        setError(message);
      }
    }

    setIsUploadingImages(false);
  }

  async function openThreadSwitcher() {
    setMobilePanel("threads");
    await loadThreadSwitcher();
  }

  function handleThreadSelect(nextThreadId: string) {
    selectThread(nextThreadId);
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
    setMobilePanel(null);
    openApprovalSheetController();
  }

  function closeApprovalSheet() {
    dismissApprovalSheetController();
  }

  function openNativeRequestSheet() {
    setMobilePanel(null);
    openNativeRequestSheetController();
  }

  function closeNativeRequestSheet() {
    dismissNativeRequestSheetController();
  }

  async function handleNativeRequestAction(action: "respond" | "cancel") {
    if (!leadNativeRequest) {
      return;
    }

    const responsePayload =
      action === "respond" && leadNativeRequest.kind === "user_input"
        ? buildNativeUserInputResponsePayload(nativeRequestQuestions, nativeRequestAnswers)
        : undefined;

    await runMutation(async () => {
      await respondNativeRequest({
        nativeRequestId: leadNativeRequest.native_request_id,
        action,
        responsePayload
      });
      dismissNativeRequestSheetController();
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

  async function submitApprovalAction(input: {
    approvalId: string;
    approved: boolean;
    confirmed?: boolean;
    nativeDecision?: unknown;
  }) {
    await runMutation(async () => {
      await resolveApproval(input.approvalId, input.approved, {
        confirmed: input.confirmed,
        nativeDecision: input.nativeDecision
      });
    }, input.approved
      ? localize(locale, {
          zh: "批准请求已处理，Codex 会继续执行。",
          en: "The approval was handled and Codex can continue."
        })
      : localize(locale, {
          zh: "批准请求已拒绝。",
          en: "The approval request was declined."
        }));
  }

  function handleApprovalAction(action: ApprovalActionOption) {
    if (!leadApproval) {
      return;
    }

    if (action.confirmationTitle && action.confirmationBody) {
      setConfirmState({
        approvalId: leadApproval.approval_id,
        approved: action.approved,
        confirmationBody: action.confirmationBody,
        confirmationTitle: action.confirmationTitle,
        kind: "approval-action",
        label: action.label,
        nativeDecision: action.nativeDecision
      });
      return;
    }

    void submitApprovalAction({
      approvalId: leadApproval.approval_id,
      approved: action.approved,
      nativeDecision: action.nativeDecision
    });
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
      case "approval-action":
        await submitApprovalAction({
          approvalId: nextConfirmState.approvalId,
          approved: nextConfirmState.approved,
          confirmed: nextConfirmState.approved ? true : undefined,
          nativeDecision: nextConfirmState.nativeDecision
        });
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
                emptyMessage={
                  describeThreadTimelineEmptyMessage(locale, {
                    degraded: isOfflineFallbackThread
                  })
                }
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
              openAttachmentSheet();
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
                <p className="section-label">{recentChatsSheetCopy.issueLabel}</p>
                <strong>{recentChatsSheetCopy.unavailableTitle}</strong>
                <p>{threadSwitcherError}</p>
              </div>
            </section>
          ) : null}
          <div className={styles.sheetList}>
            {isLoadingThreads ? (
              <p className={styles.sheetEmpty}>
                {recentChatsSheetCopy.loading}
              </p>
            ) : switcherThreads.length === 0 ? (
              <p className={styles.sheetEmpty}>
                {recentChatsSheetCopy.empty}
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
          onClose={closeAttachmentSheet}
          title={localize(locale, { zh: "添加附件", en: "Add attachment" })}
          variant="compact"
        >
          <div className={styles.sheetMenu}>
            {hasImageCapability ? (
              <button
                className={styles.sheetMenuButton}
                disabled={isMutating || isUploadingImages}
                onClick={() => {
                  closeAttachmentSheet();
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
                  closeAttachmentSheet();
                  openSkillSheet();
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
                  <strong>{detailsViewModel.modelValue}</strong>
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
                  disabled={detailsViewModel.archiveDisabled}
                  onClick={() => void handleArchiveToggle()}
                  type="button"
                >
                  {detailsViewModel.archiveLabel}
                </button>
                <button
                  className="secondary-button"
                  disabled={detailsViewModel.compactDisabled}
                  onClick={() => void handleCompactThread()}
                  type="button"
                >
                  {detailsViewModel.compactLabel}
                </button>
                <button
                  className="secondary-button"
                  disabled={detailsViewModel.forkDisabled}
                  onClick={() => void handleForkThread()}
                  type="button"
                >
                  {detailsViewModel.forkLabel}
                </button>
                <button
                  className="secondary-button"
                  disabled={detailsViewModel.reviewDisabled}
                  onClick={() => void handleStartReview()}
                  type="button"
                >
                  {detailsViewModel.reviewLabel}
                </button>
              </div>
              <div className={styles.sheetField}>
                <label className={styles.sheetLabel}>
                  <span>{localize(locale, { zh: "回滚轮数", en: "Rollback turns" })}</span>
                  <input
                    className={styles.sheetInput}
                    disabled={detailsViewModel.rollbackInputDisabled}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => setRollbackTurnsDraft(event.target.value)}
                    value={rollbackTurnsDraft}
                  />
                </label>
                <div className={styles.sheetActionGrid}>
                  <button
                    className="danger-button"
                    disabled={detailsViewModel.rollbackDisabled}
                    onClick={() => void handleRollbackThread()}
                    type="button"
                  >
                    {detailsViewModel.rollbackLabel}
                  </button>
                </div>
                {detailsViewModel.syncBlockedNote ? (
                  <p className={styles.sheetNote}>
                    {detailsViewModel.syncBlockedNote}
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
                  disabled={detailsViewModel.quickActions.refreshDisabled}
                  onClick={() => void refreshLatest()}
                  type="button"
                >
                  {localize(locale, { zh: "刷新", en: "Refresh" })}
                </button>
                <button
                  className="secondary-button"
                  disabled={detailsViewModel.quickActions.pickSkillsDisabled}
                  onClick={() => {
                    setMobilePanel(null);
                    openSkillSheet();
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
                className={
                  confirmState?.kind === "approval-action" && confirmState.approved
                    ? "primary-button"
                    : "danger-button"
                }
                onClick={() => void handleConfirmAction()}
                type="button"
              >
                {confirmState?.kind === "interrupt"
                  ? localize(locale, { zh: "停止运行", en: "Stop run" })
                  : confirmState?.label ?? localize(locale, { zh: "确认", en: "Confirm" })}
              </button>
            </>
          }
          fullHeight={false}
          open={Boolean(confirmState)}
          onClose={() => setConfirmState(null)}
          title={
            confirmState?.kind === "interrupt"
              ? localize(locale, { zh: "停止当前运行？", en: "Stop the current run?" })
              : confirmState?.confirmationTitle ??
                localize(locale, { zh: "确认这条批准请求？", en: "Confirm this approval request?" })
          }
          variant="chat"
        >
          <p className="codex-inline-note">
            {confirmState?.kind === "interrupt"
              ? localize(locale, {
                  zh: "Codex 会停止当前这轮运行，但这条聊天和现有输出会继续保留。",
                  en: "Codex will stop the current run, but this chat and its current output will remain available."
                })
              : confirmState?.confirmationBody ??
                localize(locale, {
                  zh: "请确认这次审批操作。",
                  en: "Confirm this approval action."
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
                    {formatWorkspaceTimestamp(locale, leadNativeRequest.requested_at)}
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
                                  updateNativeRequestAnswers((current) => ({
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
                            updateNativeRequestAnswers((current) => ({
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
          onClose={closeSkillSheet}
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
            <button className="secondary-button" onClick={closeApprovalSheet} type="button">
              {localize(locale, { zh: "关闭", en: "Close" })}
            </button>
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
                    {formatWorkspaceTimestamp(locale, leadApproval.requested_at)}
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

              {leadApproval.recoverable ? (
                <SharedThreadApprovalActionList
                  actions={approvalActions}
                  isMutating={isMutating}
                  onSelectAction={handleApprovalAction}
                />
              ) : null}
            </div>
          ) : null}
        </MobileSheet>
      </div>
    </div>
  );
}

export default SharedThreadWorkspace;
