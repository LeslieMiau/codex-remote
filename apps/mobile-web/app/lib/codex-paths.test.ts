import { describe, expect, it } from "vitest";

import {
  buildApprovalApiPath,
  buildNativeRequestApiPath,
  buildPatchApiPath,
  buildRunApiPath,
  buildThreadApiPath,
  buildThreadPatchPath,
  buildThreadPath
} from "./codex-paths";

describe("codex path helpers", () => {
  it("encodes thread-backed app routes", () => {
    expect(buildThreadPath("thread/one two")).toBe("/threads/thread%2Fone%20two");
    expect(buildThreadPatchPath("thread/one two", "patch/a+b")).toBe(
      "/threads/thread%2Fone%20two/patches/patch%2Fa%2Bb"
    );
  });

  it("encodes gateway api routes", () => {
    expect(buildThreadApiPath("thread/one two", "/runs")).toBe(
      "/threads/thread%2Fone%20two/runs"
    );
    expect(buildRunApiPath("run/1", "/interrupt")).toBe("/runs/run%2F1/interrupt");
    expect(buildPatchApiPath("patch/1", "/rollback")).toBe(
      "/patches/patch%2F1/rollback"
    );
    expect(buildApprovalApiPath("approval/1", "approve")).toBe(
      "/approvals/approval%2F1/approve"
    );
    expect(buildNativeRequestApiPath("native/1")).toBe(
      "/native-requests/native%2F1/respond"
    );
  });
});
