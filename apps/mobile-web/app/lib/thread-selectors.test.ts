import { describe, expect, it } from "vitest";

import { selectThreadById } from "./thread-selectors";

describe("thread-selectors", () => {
  it("returns the matching thread when it exists", () => {
    expect(
      selectThreadById(
        [
          {
            thread_id: "thread_alpha",
            title: "Alpha"
          },
          {
            thread_id: "thread_beta",
            title: "Beta"
          }
        ],
        "thread_beta"
      )
    ).toEqual({
      thread_id: "thread_beta",
      title: "Beta"
    });
  });

  it("returns null when no thread matches the id", () => {
    expect(selectThreadById([{ thread_id: "thread_alpha" }], "thread_missing")).toBeNull();
  });
});
