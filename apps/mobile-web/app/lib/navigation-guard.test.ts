import { describe, expect, it } from "vitest";

import { createNavigationGuardState } from "./navigation-guard";

describe("navigation-guard", () => {
  it("starts inactive by default", () => {
    expect(createNavigationGuardState()).toEqual({
      active: false
    });
  });
});
