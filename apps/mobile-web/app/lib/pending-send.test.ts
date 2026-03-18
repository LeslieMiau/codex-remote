import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginPendingSend,
  clearPendingSend,
  dismissPendingSend,
  editPendingSend,
  markPendingSendFailed,
  retryPendingSend
} from "./pending-send";

describe("pending-send", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a pending send with normalized defaults", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("pending-1");

    expect(
      beginPendingSend({
        body: "Inspect this thread"
      })
    ).toMatchObject({
      local_id: "pending-pending-1",
      body: "Inspect this thread",
      prompt: "Inspect this thread",
      status: "sending",
      input_items: [],
      images: [],
      skills: []
    });
  });

  it("edits and restores structured composer state", () => {
    const state = beginPendingSend({
      body: "Summarize this screenshot",
      prompt: "Summarize this screenshot",
      local_id: "pending-2",
      input_items: [
        {
          type: "skill",
          name: "checks",
          path: "/skills/checks/SKILL.md"
        },
        {
          type: "image_attachment",
          attachment_id: "attachment-1",
          file_name: "screen.png"
        }
      ],
      images: [
        {
          local_id: "image-1",
          attachment_id: "attachment-1",
          file_name: "screen.png",
          preview_url: "blob:screen"
        }
      ],
      skills: [
        {
          name: "checks",
          path: "/skills/checks/SKILL.md"
        }
      ]
    });

    expect(
      editPendingSend([state], "pending-2", "")
    ).toEqual({
      pendingSends: [],
      prompt: "Summarize this screenshot",
      inputItems: [
        {
          type: "skill",
          name: "checks",
          path: "/skills/checks/SKILL.md"
        },
        {
          type: "image_attachment",
          attachment_id: "attachment-1",
          file_name: "screen.png"
        }
      ],
      images: [
        {
          local_id: "image-1",
          attachment_id: "attachment-1",
          file_name: "screen.png",
          preview_url: "blob:screen"
        }
      ],
      skills: [
        {
          name: "checks",
          path: "/skills/checks/SKILL.md"
        }
      ]
    });
  });

  it("marks failed, retries, and clears pending sends by local id", () => {
    const pending = beginPendingSend({
      body: "Run tests",
      local_id: "pending-3"
    });

    expect(markPendingSendFailed([pending], "pending-3")).toMatchObject([
      {
        local_id: "pending-3",
        status: "failed"
      }
    ]);
    expect(retryPendingSend([pending], "pending-3")).toMatchObject([
      {
        local_id: "pending-3",
        status: "sending"
      }
    ]);
    expect(clearPendingSend([pending], "pending-3")).toEqual([]);
    expect(dismissPendingSend([pending], "pending-3")).toEqual([]);
  });
});
