import { useCallback, useEffect, useState } from "react";
import type {
  ApprovalRequest,
  NativeRequestRecord
} from "@codex-remote/protocol";

import type { NativeRequestQuestion } from "./shared-thread-workspace-screen-model";

interface RequestSheetControllerState {
  approvalSheetOpen: boolean;
  currentNativeRequestId: string | null;
  dismissedApprovalId: string | null;
  dismissedNativeRequestId: string | null;
  nativeRequestAnswers: Record<string, string>;
  nativeRequestSheetOpen: boolean;
}

interface SyncRequestSheetControllerInput {
  leadApproval: ApprovalRequest | null;
  leadNativeRequest: NativeRequestRecord | null;
  nativeRequestQuestions: NativeRequestQuestion[];
}

const INITIAL_REQUEST_SHEET_CONTROLLER_STATE: RequestSheetControllerState = {
  approvalSheetOpen: false,
  currentNativeRequestId: null,
  dismissedApprovalId: null,
  dismissedNativeRequestId: null,
  nativeRequestAnswers: {},
  nativeRequestSheetOpen: false
};

export function resetRequestSheetControllerState() {
  return INITIAL_REQUEST_SHEET_CONTROLLER_STATE;
}

function buildNativeRequestAnswers(
  current: Record<string, string>,
  questions: NativeRequestQuestion[]
) {
  const next: Record<string, string> = {};
  for (const question of questions) {
    next[question.id] = current[question.id] ?? question.options[0]?.value ?? "";
  }
  return next;
}

export function syncRequestSheetControllerState(
  current: RequestSheetControllerState,
  input: SyncRequestSheetControllerInput
) {
  const next: RequestSheetControllerState = {
    ...current
  };

  if (!input.leadApproval) {
    next.approvalSheetOpen = false;
    next.dismissedApprovalId = null;
  } else if (input.leadApproval.approval_id !== current.dismissedApprovalId) {
    next.approvalSheetOpen = true;
  }

  if (!input.leadNativeRequest) {
    next.currentNativeRequestId = null;
    next.nativeRequestSheetOpen = false;
    next.dismissedNativeRequestId = null;
    next.nativeRequestAnswers = {};
    return next;
  }

  const isSameNativeRequest =
    input.leadNativeRequest.native_request_id === current.currentNativeRequestId;
  next.currentNativeRequestId = input.leadNativeRequest.native_request_id;

  if (input.leadNativeRequest.native_request_id !== current.dismissedNativeRequestId) {
    next.nativeRequestSheetOpen = true;
  }

  next.nativeRequestAnswers = buildNativeRequestAnswers(
    isSameNativeRequest ? current.nativeRequestAnswers : {},
    input.nativeRequestQuestions
  );
  return next;
}

export function buildNativeUserInputResponsePayload(
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

export function dismissApprovalSheetState(
  current: RequestSheetControllerState,
  leadApproval: ApprovalRequest | null
) {
  return {
    ...current,
    approvalSheetOpen: false,
    dismissedApprovalId: leadApproval?.approval_id ?? current.dismissedApprovalId
  };
}

export function openApprovalSheetState(current: RequestSheetControllerState) {
  return {
    ...current,
    approvalSheetOpen: true,
    dismissedApprovalId: null
  };
}

export function dismissNativeRequestSheetState(
  current: RequestSheetControllerState,
  leadNativeRequest: NativeRequestRecord | null
) {
  return {
    ...current,
    nativeRequestSheetOpen: false,
    dismissedNativeRequestId:
      leadNativeRequest?.native_request_id ?? current.dismissedNativeRequestId
  };
}

export function openNativeRequestSheetState(current: RequestSheetControllerState) {
  return {
    ...current,
    nativeRequestSheetOpen: true,
    dismissedNativeRequestId: null
  };
}

export function useThreadRequestSheetController(input: SyncRequestSheetControllerInput) {
  const [state, setState] = useState<RequestSheetControllerState>(
    INITIAL_REQUEST_SHEET_CONTROLLER_STATE
  );

  useEffect(() => {
    setState((current) => syncRequestSheetControllerState(current, input));
  }, [input.leadApproval, input.leadNativeRequest, input.nativeRequestQuestions]);

  const openApprovalSheet = useCallback(() => {
    setState((current) => openApprovalSheetState(current));
  }, []);

  const closeApprovalSheet = useCallback(() => {
    setState((current) => dismissApprovalSheetState(current, input.leadApproval));
  }, [input.leadApproval]);

  const openNativeRequestSheet = useCallback(() => {
    setState((current) => openNativeRequestSheetState(current));
  }, []);

  const closeNativeRequestSheet = useCallback(() => {
    setState((current) => dismissNativeRequestSheetState(current, input.leadNativeRequest));
  }, [input.leadNativeRequest]);

  const reset = useCallback(() => {
    setState(INITIAL_REQUEST_SHEET_CONTROLLER_STATE);
  }, []);

  const updateNativeRequestAnswers = useCallback(
    (
      value:
        | Record<string, string>
        | ((current: Record<string, string>) => Record<string, string>)
    ) => {
      setState((current) => ({
        ...current,
        nativeRequestAnswers:
          typeof value === "function" ? value(current.nativeRequestAnswers) : value
      }));
    },
    []
  );

  return {
    ...state,
    closeApprovalSheet,
    closeNativeRequestSheet,
    openApprovalSheet,
    openNativeRequestSheet,
    reset,
    setNativeRequestAnswers(value: Record<string, string>) {
      setState((current) => ({
        ...current,
        nativeRequestAnswers: value
      }));
    },
    updateNativeRequestAnswers
  };
}
