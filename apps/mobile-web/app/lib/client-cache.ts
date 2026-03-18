import type {
  CodexCapabilitiesResponse,
  CodexLiveState,
  CodexOverviewResponse,
  CodexSharedSettingsResponse,
  CodexTranscriptPageResponse
} from "@codex-remote/protocol";

const transcriptCache = new Map<string, CodexTranscriptPageResponse>();
let cachedCapabilities: CodexCapabilitiesResponse | null = null;
let cachedLiveState: CodexLiveState | null = null;
let cachedOverview: CodexOverviewResponse | null = null;
let cachedSharedSettings: CodexSharedSettingsResponse | null = null;

export function applyOptimisticLiveState(state: CodexLiveState | null) {
  cachedLiveState = state;
  return state;
}

export function getCachedCapabilities() {
  return cachedCapabilities;
}

export function getCachedLiveState() {
  return cachedLiveState;
}

export function getCachedOverview() {
  return cachedOverview;
}

export function getCachedSharedSettings() {
  return cachedSharedSettings;
}

export function getCachedTranscript(threadId?: string) {
  if (!threadId) {
    return null;
  }
  return transcriptCache.get(threadId) ?? null;
}

export function setCachedCapabilities(value: CodexCapabilitiesResponse | null) {
  cachedCapabilities = value;
}

export function setCachedLiveState(state: CodexLiveState | null) {
  cachedLiveState = state;
}

export function setCachedOverview(overview: CodexOverviewResponse | null) {
  cachedOverview = overview;
}

export function setCachedSharedSettings(value: CodexSharedSettingsResponse | null) {
  cachedSharedSettings = value;
}

export function setCachedTranscript(threadId: string, transcript: CodexTranscriptPageResponse | null) {
  if (!threadId) {
    return;
  }
  if (transcript) {
    transcriptCache.set(threadId, transcript);
    cachedLiveState = transcript.live_state ?? null;
    return;
  }
  transcriptCache.delete(threadId);
}
