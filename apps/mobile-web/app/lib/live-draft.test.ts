import { describe, expect, it } from "vitest";

import { buildInlineLiveDraft, renderLivePanelBody } from "./live-draft";

describe("live-draft", () => {
  it("builds an inline assistant draft only from real assistant text", () => {
    const draft = buildInlineLiveDraft({
      liveState: {
        status: "running",
        detail: "Working on it",
        assistant_text: "Here is the partial reply",
        updated_at: "2026-03-16T09:00:00.000Z",
        awaiting_native_commit: false,
        details: []
      },
      locale: "en",
      messages: [],
      threadId: "thread_live"
    });

    expect(draft).toMatchObject({
      message_id: "live-draft:thread_live",
      role: "assistant",
      body: "Here is the partial reply",
      is_live_draft: true
    });
  });

  it("does not build a draft from status text alone", () => {
    expect(
      buildInlineLiveDraft({
        liveState: {
          status: "running",
          detail: "Working on it",
          assistant_text: "",
          updated_at: "2026-03-16T09:00:00.000Z",
          awaiting_native_commit: false,
          details: []
        },
        locale: "en",
        messages: [],
        threadId: "thread_live"
      })
    ).toBeNull();
  });

  it("renders waiting text when native confirmation is still pending", () => {
    expect(
      renderLivePanelBody(
        "en",
        {
          status: "running",
          detail: "",
          assistant_text: "",
          updated_at: "2026-03-16T09:00:00.000Z",
          awaiting_native_commit: true,
          details: []
        },
        false
      )
    ).toContain("Waiting for the native Codex timeline");
  });
});
