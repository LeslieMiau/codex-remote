function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

export function buildThreadPath(threadId: string) {
  return `/threads/${encodePathSegment(threadId)}`;
}

export function buildThreadPatchPath(threadId: string, patchId: string) {
  return `${buildThreadPath(threadId)}/patches/${encodePathSegment(patchId)}`;
}

export function buildThreadApiPath(threadId: string, suffix = "") {
  return `${buildThreadPath(threadId)}${suffix}`;
}

export function buildRunApiPath(runId: string, suffix = "") {
  return `/runs/${encodePathSegment(runId)}${suffix}`;
}

export function buildPatchApiPath(patchId: string, suffix = "") {
  return `/patches/${encodePathSegment(patchId)}${suffix}`;
}

export function buildApprovalApiPath(
  approvalId: string,
  action: "approve" | "reject"
) {
  return `/approvals/${encodePathSegment(approvalId)}/${action}`;
}

export function buildNativeRequestApiPath(nativeRequestId: string) {
  return `/native-requests/${encodePathSegment(nativeRequestId)}/respond`;
}
