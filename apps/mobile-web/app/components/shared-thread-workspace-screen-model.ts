import type {
  ApprovalRequest,
  CodexCapabilitiesResponse,
  CodexSharedSettingsResponse,
  CodexTranscriptPageResponse,
  NativeRequestRecord
} from "@codex-remote/protocol";

import {
  getDisplayThreadTitle,
  isRecoveryFallbackThread
} from "../lib/chat-thread-presentation";
import {
  formatDateTime,
  localize
} from "../lib/locale";
import type { PendingSendImage } from "../lib/pending-send";
import type { ThreadListRoute } from "../lib/thread-list-route-storage";

export interface NativeRequestQuestionOption {
  description?: string;
  label: string;
  value: string;
}

export interface NativeRequestQuestion {
  id: string;
  options: NativeRequestQuestionOption[];
  question: string;
}

interface SharedThreadWorkspaceScreenModelInput {
  capabilities: CodexCapabilitiesResponse | null;
  error: string | null;
  isMutating: boolean;
  locale: "zh" | "en";
  returnToListHref: ThreadListRoute;
  selectedImages: PendingSendImage[];
  sharedSettings: CodexSharedSettingsResponse | null;
  transcript: CodexTranscriptPageResponse | null;
}

function capabilityMessage(
  locale: "zh" | "en",
  capabilities: CodexCapabilitiesResponse | null,
  fallback: { zh: string; en: string }
) {
  return capabilities?.reason ?? localize(locale, fallback);
}

export function formatWorkspaceTimestamp(locale: "zh" | "en", value?: string) {
  if (!value) {
    return locale === "zh" ? "刚刚" : "Just now";
  }
  return formatDateTime(locale, value);
}

export function parseNativeRequestQuestions(
  request: NativeRequestRecord | null | undefined
) {
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

export function buildSharedThreadWorkspaceScreenModel(
  input: SharedThreadWorkspaceScreenModelInput
) {
  const pendingApprovals =
    input.transcript?.approvals.filter((approval) => approval.status === "requested") ?? [];
  const pendingNativeRequests =
    input.transcript?.native_requests.filter((request) => request.status === "requested") ?? [];
  const pendingPatches =
    input.transcript?.patches.filter(
      (patch) => patch.status !== "applied" && patch.status !== "discarded"
    ) ?? [];
  const pendingApprovalsById = new Map(
    pendingApprovals.map((approval) => [approval.approval_id, approval] as const)
  );
  const leadNativeRequest = pendingNativeRequests[0] ?? null;
  const leadApproval = pendingApprovals[0] ?? null;
  const leadPatch = pendingPatches[0] ?? null;
  const nativeRequestQuestions = parseNativeRequestQuestions(leadNativeRequest);
  const activeRunId = input.transcript?.thread.active_turn_id ?? null;
  const isRunActive =
    Boolean(activeRunId) &&
    (input.transcript?.thread.state === "running" ||
      input.transcript?.thread.state === "waiting_approval" ||
      input.transcript?.thread.state === "waiting_input");
  const composerDisabledReason = !input.transcript
    ? localize(input.locale, {
        zh: "正在加载聊天状态。",
        en: "Loading chat state."
      })
    : input.transcript.thread.archived
      ? localize(input.locale, {
          zh: "这条已归档聊天当前为只读状态。",
          en: "Archived chats are read-only."
        })
      : !input.capabilities?.run_start
        ? capabilityMessage(input.locale, input.capabilities, {
            zh: "当前 Codex 版本不支持在手机端发起共享运行。",
            en: "This Codex build cannot start shared runs from the phone."
          })
        : pendingNativeRequests.length > 0
          ? localize(input.locale, {
              zh: "先处理补充输入请求，再继续发新消息。",
              en: "Resolve the input request before sending a new message."
            })
          : pendingApprovals.length > 0
            ? localize(input.locale, {
                zh: "先处理批准请求，再继续发新消息。",
                en: "Resolve the approval request before sending a new message."
              })
            : pendingPatches.length > 0
              ? localize(input.locale, {
                  zh: "先完成变更审查，再继续发新消息。",
                  en: "Review the pending change before sending a new message."
                })
              : input.selectedImages.some((image) => image.status === "uploading")
                ? localize(input.locale, {
                    zh: "图片上传完成后才能继续发送。",
                    en: "Wait for image uploads to finish before sending."
                  })
                : input.selectedImages.some((image) => image.status === "failed")
                  ? localize(input.locale, {
                      zh: "请移除上传失败的图片，或重新选择后再发送。",
                      en: "Remove the failed image upload or try again before sending."
                    })
                  : isRunActive && !input.capabilities?.live_follow_up
                    ? localize(input.locale, {
                        zh: "当前 Codex 版本暂不支持运行中追加指令。",
                        en: "Live follow-up unavailable on this Codex build."
                      })
                    : null;
  const composerInputDisabled =
    !input.transcript || input.transcript.thread.archived || input.isMutating;
  const remoteThreadActionsBlocked = Boolean(
    input.transcript &&
      (!input.transcript.thread.adapter_thread_ref ||
        input.transcript.thread.sync_state === "sync_pending")
  );
  const returnToListLabel =
    input.returnToListHref === "/queue"
      ? localize(input.locale, { zh: "返回收件箱", en: "Back to inbox" })
      : localize(input.locale, { zh: "打开聊天列表", en: "Open chats" });
  const selectedModelLabel =
    input.sharedSettings?.available_models.find(
      (option) => option.slug === input.sharedSettings?.model
    )?.display_name ??
    input.sharedSettings?.model ??
    null;
  const hasImageCapability = Boolean(
    input.capabilities?.supports_images && input.capabilities?.image_inputs
  );
  const hasSkillCapability = Boolean(input.capabilities?.skills_input);
  const displayThreadTitle = getDisplayThreadTitle(input.locale, input.transcript?.thread);
  const isOfflineFallbackThread = Boolean(
    input.transcript?.thread &&
      isRecoveryFallbackThread(input.transcript.thread) &&
      input.capabilities?.shared_state_available === false
  );
  const headerSubtitle = input.transcript
    ? `${input.transcript.thread.project_label} · ${formatWorkspaceTimestamp(
        input.locale,
        input.transcript.thread.updated_at
      )}`
    : localize(input.locale, {
        zh: "正在连接聊天",
        en: "Connecting"
      });
  const topStatus = input.error
    ? {
        detail: input.error,
        title: localize(input.locale, {
          zh: "当前状态异常",
          en: "Something needs attention"
        }),
        tone: "danger" as const
      }
    : null;

  return {
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
  };
}
