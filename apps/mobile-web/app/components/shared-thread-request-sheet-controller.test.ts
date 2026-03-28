import { describe, expect, it } from "vitest";

import type {
  ApprovalRequest,
  NativeRequestRecord
} from "@codex-remote/protocol";

import {
  buildNativeUserInputResponsePayload,
  dismissApprovalSheetState,
  dismissNativeRequestSheetState,
  resetRequestSheetControllerState,
  syncRequestSheetControllerState
} from "./shared-thread-request-sheet-controller";
import type { NativeRequestQuestion } from "./shared-thread-workspace-screen-model";

function buildApproval(
  approvalId: string
): ApprovalRequest {
  return {
    approval_id: approvalId,
    project_id: "project_demo",
    thread_id: "thread_demo",
    turn_id: "turn_demo",
    kind: "command",
    source: "legacy_gateway",
    status: "requested",
    reason: "Need confirmation.",
    requested_at: "2026-03-28T10:00:00.000Z",
    recoverable: true
  };
}

function buildNativeRequest(
  nativeRequestId: string
): NativeRequestRecord {
  return {
    native_request_id: nativeRequestId,
    thread_id: "thread_demo",
    turn_id: "turn_demo",
    kind: "user_input",
    source: "native",
    status: "requested",
    requested_at: "2026-03-28T10:00:00.000Z"
  };
}

const QUESTIONS: NativeRequestQuestion[] = [
  {
    id: "answer",
    question: "Choose one",
    options: [
      {
        label: "Alpha",
        value: "alpha"
      }
    ]
  }
];

describe("thread request sheet controller", () => {
  it("opens approval and native-request sheets for new pending items", () => {
    const state = syncRequestSheetControllerState(
      resetRequestSheetControllerState(),
      {
        leadApproval: buildApproval("approval-1"),
        leadNativeRequest: buildNativeRequest("native-1"),
        nativeRequestQuestions: QUESTIONS
      }
    );

    expect(state.approvalSheetOpen).toBe(true);
    expect(state.nativeRequestSheetOpen).toBe(true);
    expect(state.nativeRequestAnswers).toEqual({
      answer: "alpha"
    });
  });

  it("keeps a dismissed sheet closed until a new request arrives", () => {
    const initial = syncRequestSheetControllerState(
      resetRequestSheetControllerState(),
      {
        leadApproval: buildApproval("approval-1"),
        leadNativeRequest: buildNativeRequest("native-1"),
        nativeRequestQuestions: QUESTIONS
      }
    );
    const dismissedApproval = dismissApprovalSheetState(
      initial,
      buildApproval("approval-1")
    );
    const dismissedNative = dismissNativeRequestSheetState(
      dismissedApproval,
      buildNativeRequest("native-1")
    );

    const sameRequests = syncRequestSheetControllerState(dismissedNative, {
      leadApproval: buildApproval("approval-1"),
      leadNativeRequest: buildNativeRequest("native-1"),
      nativeRequestQuestions: QUESTIONS
    });

    expect(sameRequests.approvalSheetOpen).toBe(false);
    expect(sameRequests.nativeRequestSheetOpen).toBe(false);

    const nextRequests = syncRequestSheetControllerState(sameRequests, {
      leadApproval: buildApproval("approval-2"),
      leadNativeRequest: buildNativeRequest("native-2"),
      nativeRequestQuestions: QUESTIONS
    });

    expect(nextRequests.approvalSheetOpen).toBe(true);
    expect(nextRequests.nativeRequestSheetOpen).toBe(true);
  });

  it("clears native request state when no request remains", () => {
    const state = syncRequestSheetControllerState(
      resetRequestSheetControllerState(),
      {
        leadApproval: null,
        leadNativeRequest: buildNativeRequest("native-1"),
        nativeRequestQuestions: QUESTIONS
      }
    );

    const cleared = syncRequestSheetControllerState(state, {
      leadApproval: null,
      leadNativeRequest: null,
      nativeRequestQuestions: []
    });

    expect(cleared.nativeRequestSheetOpen).toBe(false);
    expect(cleared.dismissedNativeRequestId).toBe(null);
    expect(cleared.nativeRequestAnswers).toEqual({});
  });

  it("keeps edited answers for the same request and resets defaults for a new request", () => {
    const initial = syncRequestSheetControllerState(
      resetRequestSheetControllerState(),
      {
        leadApproval: null,
        leadNativeRequest: buildNativeRequest("native-1"),
        nativeRequestQuestions: QUESTIONS
      }
    );
    const edited = syncRequestSheetControllerState(
      {
        ...initial,
        nativeRequestAnswers: {
          answer: "custom"
        }
      },
      {
        leadApproval: null,
        leadNativeRequest: buildNativeRequest("native-1"),
        nativeRequestQuestions: QUESTIONS
      }
    );
    const nextRequest = syncRequestSheetControllerState(edited, {
      leadApproval: null,
      leadNativeRequest: buildNativeRequest("native-2"),
      nativeRequestQuestions: QUESTIONS
    });

    expect(edited.nativeRequestAnswers).toEqual({
      answer: "custom"
    });
    expect(nextRequest.nativeRequestAnswers).toEqual({
      answer: "alpha"
    });
  });

  it("builds user-input payloads from the current answers", () => {
    expect(
      buildNativeUserInputResponsePayload(QUESTIONS, {
        answer: "custom"
      })
    ).toEqual({
      answers: {
        answer: {
          answers: ["custom"]
        }
      }
    });
  });
});
