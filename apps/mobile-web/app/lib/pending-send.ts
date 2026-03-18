import type { TurnInputItem } from "@codex-remote/protocol";

export interface PendingSendImage {
  local_id: string;
  id?: string;
  attachment_id?: string;
  content_type?: string;
  file_name?: string;
  path?: string;
  preview_url?: string;
}

export interface PendingSendSkill {
  id?: string;
  name: string;
  path: string;
  description?: string;
  display_name?: string;
}

export interface PendingSendState {
  local_id: string;
  body: string;
  prompt: string;
  created_at: string;
  status: "sending" | "failed";
  input_items: TurnInputItem[];
  images: PendingSendImage[];
  skills: PendingSendSkill[];
}

interface BeginPendingSendInput {
  local_id?: string;
  body: string;
  prompt?: string;
  created_at?: string;
  status?: PendingSendState["status"];
  input_items?: TurnInputItem[];
  images?: PendingSendImage[];
  skills?: PendingSendSkill[];
}

function pendingSendId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pending-${crypto.randomUUID()}`;
  }
  return `pending-${Date.now()}`;
}

export function beginPendingSend(input: BeginPendingSendInput): PendingSendState {
  return {
    local_id: input.local_id ?? pendingSendId(),
    body: input.body,
    prompt: input.prompt ?? input.body,
    created_at: input.created_at ?? new Date().toISOString(),
    status: input.status ?? "sending",
    input_items: [...(input.input_items ?? [])],
    images: [...(input.images ?? [])],
    skills: [...(input.skills ?? [])]
  };
}

export function clearPendingSend(pendingSends: PendingSendState[], localId: string) {
  return dismissPendingSend(pendingSends, localId);
}

export function dismissPendingSend(
  pendingSends: PendingSendState[],
  localId: string
) {
  return pendingSends.filter((entry) => entry.local_id !== localId);
}

export function editPendingSend(
  pendingSends: PendingSendState[],
  localId: string,
  currentPrompt: string
) {
  const target = pendingSends.find((entry) => entry.local_id === localId) ?? null;
  return {
    pendingSends: pendingSends.filter((entry) => entry.local_id !== localId),
    prompt: target?.prompt ?? currentPrompt,
    inputItems: [...(target?.input_items ?? [])],
    images: [...(target?.images ?? [])],
    skills: [...(target?.skills ?? [])]
  };
}

export function markPendingSendFailed(
  pendingSends: PendingSendState[],
  localId: string
) {
  return pendingSends.map((entry) =>
    entry.local_id === localId ? { ...entry, status: "failed" as const } : entry
  );
}

export function retryPendingSend(
  pendingSends: PendingSendState[],
  localId: string
) {
  return pendingSends.map((entry) =>
    entry.local_id === localId ? { ...entry, status: "sending" as const } : entry
  );
}
