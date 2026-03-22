import { describe, expect, it } from "vitest";

import {
  describeNativeRequestActionLabel,
  describeNativeRequestRecoveryNotice,
  describeNativeRequestTaskDetail,
  describeNativeRequestGateBody,
  describePendingInputSummary
} from "./native-input-copy";

describe("describePendingInputSummary", () => {
  it("returns count-aware copy for pending inputs", () => {
    expect(describePendingInputSummary("en", 1)).toMatchObject({
      cta: "Reply now",
      title: "1 chat is waiting for your input"
    });

    expect(describePendingInputSummary("zh", 3)).toMatchObject({
      cta: "先去回复",
      title: "有 3 条聊天正在等你输入"
    });
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
