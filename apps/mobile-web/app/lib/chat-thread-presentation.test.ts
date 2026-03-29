import { describe, expect, it } from "vitest";

import {
  buildMobileThreadListLines,
  getDisplayThreadTitle,
  hasBlockingThreadAttention,
  isRecoveryFallbackThread,
  shouldHideThreadFromMobileList
} from "./chat-thread-presentation";

describe("chat thread presentation", () => {
  it("flags gateway fallback threads as recovery copies", () => {
    expect(
      isRecoveryFallbackThread({
        degraded: true,
        project_label: "Recovered project",
        source: "gateway_fallback",
        title: "Recovered thread"
      })
    ).toBe(true);
  });

  it("hides recovery titles behind a neutral chat label", () => {
    expect(
      getDisplayThreadTitle("en", {
        degraded: true,
        project_label: "Recovered project",
        source: "gateway_fallback",
        title: "Recovered thread"
      })
    ).toBe("Chat");
    expect(
      getDisplayThreadTitle("zh", {
        degraded: true,
        project_label: "Recovered project",
        source: "gateway_fallback",
        title: "Recovered thread"
      })
    ).toBe("聊天");
  });

  it("keeps real thread titles untouched", () => {
    expect(
      getDisplayThreadTitle("en", {
        degraded: false,
        project_label: "codex-remote",
        source: "native_confirmed",
        title: "Fix mobile chat layout"
      })
    ).toBe("Fix mobile chat layout");
  });

  it("treats approvals, input, review, and hard failures as blocking attention", () => {
    expect(
      hasBlockingThreadAttention({
        archived: false,
        degraded: false,
        pending_approvals: 0,
        pending_native_requests: 1,
        pending_patches: 0,
        project_label: "repo",
        source: "codex-app-server",
        state: "waiting_input",
        title: "Needs input"
      })
    ).toBe(true);

    expect(
      hasBlockingThreadAttention({
        archived: false,
        degraded: false,
        pending_approvals: 0,
        pending_native_requests: 0,
        pending_patches: 0,
        project_label: "repo",
        source: "codex-app-server",
        state: "running",
        title: "Still running"
      })
    ).toBe(false);
  });

  it("hides archived and recovery fallback threads from the mobile list by default", () => {
    expect(
      shouldHideThreadFromMobileList({
        archived: true,
        degraded: false,
        pending_approvals: 0,
        pending_native_requests: 0,
        pending_patches: 0,
        project_label: "repo",
        source: "codex-app-server",
        state: "ready",
        title: "Archived chat"
      })
    ).toBe(true);

    expect(
      shouldHideThreadFromMobileList({
        archived: false,
        degraded: true,
        pending_approvals: 0,
        pending_native_requests: 0,
        pending_patches: 0,
        project_label: "Recovered project",
        source: "gateway_fallback",
        state: "ready",
        title: "Recovered thread"
      })
    ).toBe(true);

    expect(
      shouldHideThreadFromMobileList({
        archived: false,
        degraded: true,
        pending_approvals: 1,
        pending_native_requests: 0,
        pending_patches: 0,
        project_label: "Recovered project",
        source: "gateway_fallback",
        state: "waiting_approval",
        title: "Recovered thread"
      })
    ).toBe(false);
  });

  it("omits duplicated repo names from mobile thread metadata", () => {
    expect(
      buildMobileThreadListLines({
        displayTitle: "codex-remote",
        preview: "Ready for follow-up",
        project_label: "codex-remote",
        repo_root: "/Users/miau/Documents/codex-remote"
      })
    ).toEqual({
      secondaryLine: "Ready for follow-up",
      tertiaryLine: null
    });
  });

  it("keeps distinct project and repo metadata when they add context", () => {
    expect(
      buildMobileThreadListLines({
        displayTitle: "Fix the queue drawer",
        preview: "Needs follow-up",
        project_label: "Codex Remote",
        repo_root: "/Users/miau/Documents/codex-remote"
      })
    ).toEqual({
      secondaryLine: "Needs follow-up · Codex Remote",
      tertiaryLine: "codex-remote"
    });
  });

  it("prefers status copy over repo metadata on the secondary line", () => {
    expect(
      buildMobileThreadListLines({
        displayTitle: "Fix the queue drawer",
        preview: "Approval needed",
        project_label: "Codex Remote",
        repo_root: "/Users/miau/Documents/codex-remote",
        statusLabel: "Approval"
      })
    ).toEqual({
      secondaryLine: "Approval needed · Approval",
      tertiaryLine: "Codex Remote · codex-remote"
    });
  });
});
