import { describe, expect, it } from "vitest";

import { shouldRefreshThreadAfterEvent } from "./thread-realtime-state";

function buildEvent(eventType: string) {
  return {
    event_type: eventType,
    payload: {},
    schema_version: "1",
    stream_seq: 1
  } as const;
}

describe("thread realtime state helpers", () => {
  it("does not refresh on turn progress events", () => {
    expect(shouldRefreshThreadAfterEvent(buildEvent("turn.progress"))).toBe(false);
    expect(shouldRefreshThreadAfterEvent(buildEvent("turn.started"))).toBe(false);
  });

  it("refreshes on terminal and action-required events", () => {
    expect(shouldRefreshThreadAfterEvent(buildEvent("approval.required"))).toBe(true);
    expect(shouldRefreshThreadAfterEvent(buildEvent("native_request.required"))).toBe(true);
    expect(shouldRefreshThreadAfterEvent(buildEvent("native_request.resolved"))).toBe(true);
    expect(shouldRefreshThreadAfterEvent(buildEvent("patch.ready"))).toBe(true);
    expect(shouldRefreshThreadAfterEvent(buildEvent("thread.metadata.updated"))).toBe(true);
    expect(shouldRefreshThreadAfterEvent(buildEvent("turn.completed"))).toBe(true);
    expect(shouldRefreshThreadAfterEvent(buildEvent("turn.failed"))).toBe(true);
  });
});
