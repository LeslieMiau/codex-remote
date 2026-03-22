import { describe, expect, it } from "vitest";

import {
  describeNativeRequestActionLabel,
  describeNativeRequestAttentionLabel,
  describeNativeRequestQueueLabel,
  describeNativeRequestRecoveryNotice,
  describeNativeRequestTaskDetail,
  describeNativeRequestGateBody,
  describePendingInputSummary,
  describeQueueInputPreview,
  describeThreadPendingInputPreview,
  isDesktopOrientedNativeRequest
} from "./native-input-copy";

describe("describePendingInputSummary", () => {
  it("returns count-aware copy for pending inputs", () => {
    expect(describePendingInputSummary("en", 1)).toMatchObject({
      cta: "Reply now",
      eyebrow: "Reply first",
      title: "1 chat is waiting for your input"
    });

    expect(describePendingInputSummary("zh", 3)).toMatchObject({
      cta: "先去回复",
      eyebrow: "先回复这里",
      title: "有 3 条聊天正在等你输入"
    });
  });

  it("switches summary copy for desktop-oriented requests", () => {
    expect(describePendingInputSummary("en", 2, "dynamic_tool")).toMatchObject({
      cta: "See recovery steps",
      eyebrow: "Desktop recovery",
      title: "1 chat needs desktop recovery, plus 1 more waiting"
    });
    expect(describePendingInputSummary("zh", 1, "auth_refresh").body).toContain(
      "桌面 Codex app"
    );
  });
});

describe("describeNativeRequestGateBody", () => {
  it("explains user input backlog clearly", () => {
    expect(describeNativeRequestGateBody("en", "user_input", 2)).toContain(
      "1 more are still waiting"
    );
    expect(describeNativeRequestGateBody("zh", "user_input", 1)).toContain(
      "Codex 才能继续当前运行"
    );
  });

  it("differentiates dynamic tool and auth refresh guidance", () => {
    expect(describeNativeRequestGateBody("en", "dynamic_tool", 1)).toContain(
      "dynamic tool request"
    );
    expect(describeNativeRequestGateBody("en", "auth_refresh", 1)).toContain(
      "finish authentication in desktop Codex app"
    );
  });
});

describe("native request recovery helpers", () => {
  it("detects desktop-oriented requests", () => {
    expect(isDesktopOrientedNativeRequest("dynamic_tool")).toBe(true);
    expect(isDesktopOrientedNativeRequest("auth_refresh")).toBe(true);
    expect(isDesktopOrientedNativeRequest("user_input")).toBe(false);
  });

  it("adapts queue preview and labels to request kind", () => {
    expect(
      describeQueueInputPreview("en", "dynamic_tool", "Tool access is required.")
    ).toContain("paused on a dynamic tool step");
    expect(describeNativeRequestQueueLabel("zh", "auth_refresh")).toBe("桌面认证");
    expect(describeNativeRequestQueueLabel("en", "user_input")).toBe("Reply here");
    expect(describeNativeRequestAttentionLabel("en", "dynamic_tool")).toBe(
      "Desktop recovery"
    );
    expect(describeNativeRequestAttentionLabel("zh", "user_input")).toBe("等待回复");
  });

  it("updates thread preview copy for desktop-oriented requests", () => {
    expect(describeThreadPendingInputPreview("en", "dynamic_tool")).toContain(
      "desktop Codex app"
    );
    expect(describeThreadPendingInputPreview("zh", "user_input")).toContain(
      "Codex 正等你回复"
    );
  });

  it("uses stronger task detail for desktop-oriented requests", () => {
    expect(
      describeNativeRequestTaskDetail("en", "dynamic_tool", "Tool access is required.")
    ).toContain("desktop Codex app");
    expect(describeNativeRequestTaskDetail("zh", "auth_refresh")).toContain(
      "桌面 Codex app"
    );
  });

  it("switches action labels by request kind", () => {
    expect(describeNativeRequestActionLabel("en", "user_input")).toBe(
      "Open input request"
    );
    expect(describeNativeRequestActionLabel("zh", "dynamic_tool")).toBe(
      "查看恢复步骤"
    );
  });

  it("returns recovery notices for desktop-oriented requests", () => {
    expect(describeNativeRequestRecoveryNotice("en", "dynamic_tool").title).toContain(
      "continue on desktop"
    );
    expect(describeNativeRequestRecoveryNotice("zh", "auth_refresh").body).toContain(
      "认证刷新"
    );
  });
});
