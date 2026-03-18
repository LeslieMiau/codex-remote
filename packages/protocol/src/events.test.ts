import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION } from "./common";
import { GatewayEventSchema } from "./events";

describe("protocol events", () => {
  it("applies the default schema version", () => {
    const parsed = GatewayEventSchema.parse({
      event_type: "turn.started",
      payload: {},
      stream_seq: 1
    });

    expect(parsed.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("rejects events without a payload object", () => {
    expect(() =>
      GatewayEventSchema.parse({
        event_type: "turn.started",
        payload: "invalid",
        stream_seq: 1
      })
    ).toThrow();
  });
});
