import { describe, expect, it } from "vitest";

import {
  buildOverviewEmptyStateCopy,
  buildQueueEmptyStateCopy,
  buildRecentChatsSheetCopy,
  describeThreadTimelineEmptyMessage
} from "./shared-empty-state-presentation";

describe("shared empty-state presentation", () => {
  it("returns degraded thread copy for fallback chats", () => {
    expect(
      describeThreadTimelineEmptyMessage("en", {
        degraded: true
      })
    ).toContain("degraded");
  });

  it("returns search-specific overview empty copy", () => {
    expect(
      buildOverviewEmptyStateCopy({
        hasThreadSearch: true,
        isFallbackOnlyOverview: false,
        locale: "en"
      })
    ).toEqual({
      body: "No matching chats.",
      title: "Try a different keyword.",
      detail: "Search by title, project name, or repo path."
    });
  });

  it("returns degraded queue copy when shared state is unavailable", () => {
    expect(
      buildQueueEmptyStateCopy({
        inputFilterActive: false,
        isFallbackOnlyOverview: true,
        locale: "en",
        reason: "Shared gateway is offline."
      })
    ).toEqual({
      body: "Shared gateway is offline.",
      actionLabel: "Back to chats"
    });
  });

  it("shares recent chat sheet copy between workspaces", () => {
    expect(buildRecentChatsSheetCopy("en")).toEqual({
      empty: "No other chats yet.",
      issueLabel: "Chat list issue",
      loading: "Loading recent chats.",
      unavailableTitle: "Recent chats are temporarily unavailable"
    });
  });
});
