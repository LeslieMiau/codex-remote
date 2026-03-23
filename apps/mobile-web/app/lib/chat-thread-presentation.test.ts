import { describe, expect, it } from "vitest";

import {
  getDisplayThreadTitle,
  isRecoveryFallbackThread
} from "./chat-thread-presentation";

describe("chat thread presentation", () => {
  it("flags gateway fallback threads as recovery copies", () => {
    expect(
      isRecoveryFallbackThread({
        project_label: "Recovered project",
        source: "gateway_fallback",
        title: "Recovered thread"
      })
    ).toBe(true);
  });

  it("hides recovery titles behind a neutral chat label", () => {
    expect(
      getDisplayThreadTitle("en", {
        project_label: "Recovered project",
        source: "gateway_fallback",
        title: "Recovered thread"
      })
    ).toBe("Chat");
    expect(
      getDisplayThreadTitle("zh", {
        project_label: "Recovered project",
        source: "gateway_fallback",
        title: "Recovered thread"
      })
    ).toBe("聊天");
  });

  it("keeps real thread titles untouched", () => {
    expect(
      getDisplayThreadTitle("en", {
        project_label: "codex-remote",
        source: "native_confirmed",
        title: "Fix mobile chat layout"
      })
    ).toBe("Fix mobile chat layout");
  });
});
