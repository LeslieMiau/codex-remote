import { describe, expect, it } from "vitest";

import {
  consumeThreadFlashMessage,
  writeThreadFlashMessage
} from "./flash-message";

describe("flash-message", () => {
  it("returns a stored flash message once and clears it afterwards", () => {
    writeThreadFlashMessage({
      threadId: "thread_flash",
      message: "Patch applied"
    });

    expect(consumeThreadFlashMessage("thread_flash")).toBe("Patch applied");
    expect(consumeThreadFlashMessage("thread_flash")).toBeNull();
  });
});
