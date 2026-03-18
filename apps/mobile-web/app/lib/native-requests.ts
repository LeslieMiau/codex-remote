"use client";

import type { NativeRequestRecord } from "@codex-remote/protocol";

export interface NativeInputQuestion {
  id: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readQuestionLabel(source: Record<string, unknown>) {
  const candidates = [source.question, source.prompt, source.label, source.title];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function getRequestedNativeRequests(nativeRequests: NativeRequestRecord[]) {
  return nativeRequests.filter((request) => request.status === "requested");
}

export function extractNativeInputQuestions(
  request: NativeRequestRecord | null | undefined
): NativeInputQuestion[] {
  const payload = asRecord(request?.payload);
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions.flatMap((question, index) => {
    const source = asRecord(question);
    if (!source) {
      return [];
    }

    const label = readQuestionLabel(source);
    if (!label) {
      return [];
    }

    const idCandidate = source.id ?? source.questionId ?? source.key ?? source.name;
    const id =
      typeof idCandidate === "string" && idCandidate.trim()
        ? idCandidate.trim()
        : `question-${index + 1}`;

    return [
      {
        id,
        label,
        placeholder:
          typeof source.placeholder === "string" && source.placeholder.trim()
            ? source.placeholder.trim()
            : undefined,
        defaultValue:
          typeof source.defaultValue === "string"
            ? source.defaultValue
            : typeof source.default === "string"
              ? source.default
              : undefined
      }
    ];
  });
}

export function buildNativeRequestResponsePayload(input: {
  request: NativeRequestRecord;
  questionResponses?: Record<string, string>;
  fallbackText?: string;
}) {
  const questions = extractNativeInputQuestions(input.request);
  const filteredAnswers = Object.fromEntries(
    Object.entries(input.questionResponses ?? {}).filter(([, value]) => value.trim().length > 0)
  );
  const trimmedFallback = input.fallbackText?.trim() ?? "";

  if (questions.length > 0) {
    return {
      answers: filteredAnswers
    };
  }

  return {
    answers: trimmedFallback ? { response: trimmedFallback } : {},
    text: trimmedFallback || undefined
  };
}
