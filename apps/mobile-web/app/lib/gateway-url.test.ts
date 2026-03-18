import { describe, expect, it } from "vitest";

import {
  buildGatewayHttpUrl,
  buildGatewayWsUrl,
  getGatewayBase
} from "./gateway-url";

const TAILNET_ORIGIN = "https://gateway-host.tailnet.ts.net";

describe("gateway-url", () => {
  it("defaults to the same-origin /api prefix", () => {
    expect(getGatewayBase(undefined)).toBe("/api");
    expect(buildGatewayHttpUrl("/api", "/threads")).toBe("/api/threads");
  });

  it("keeps explicit absolute gateway origins", () => {
    expect(getGatewayBase(` ${TAILNET_ORIGIN}/api `)).toBe(`${TAILNET_ORIGIN}/api`);
    expect(
      buildGatewayHttpUrl(`${TAILNET_ORIGIN}/api`, "/events?thread_id=thread_123")
    ).toBe(`${TAILNET_ORIGIN}/api/events?thread_id=thread_123`);
  });

  it("builds websocket urls for both relative and absolute bases", () => {
    expect(buildGatewayWsUrl("/api", "/ws", TAILNET_ORIGIN)).toBe(
      "wss://gateway-host.tailnet.ts.net/api/ws"
    );
    expect(buildGatewayWsUrl("http://127.0.0.1:8787", "/ws")).toBe(
      "ws://127.0.0.1:8787/ws"
    );
  });
});
