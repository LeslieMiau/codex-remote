import { describe, expect, it } from "vitest";

import {
  evaluateTailscaleAccess,
  readTailscaleAuthConfig
} from "./tailscale-auth";

describe("tailscale-auth", () => {
  it("defaults to off when no allowlist is configured", () => {
    expect(readTailscaleAuthConfig({})).toEqual({
      mode: "off",
      allowedUserLogins: []
    });
  });

  it("enables enforcement when allowed logins are present", () => {
    expect(
      readTailscaleAuthConfig({
        CODEX_REMOTE_TAILSCALE_ALLOWED_USER_LOGINS: "miau, codex"
      })
    ).toEqual({
      mode: "enforce",
      allowedUserLogins: ["miau", "codex"]
    });
  });

  it("allows loopback health access without a tailscale identity", () => {
    expect(
      evaluateTailscaleAccess({
        config: {
          mode: "enforce",
          allowedUserLogins: ["miau"]
        },
        headers: {
          host: "127.0.0.1:8787"
        }
      })
    ).toMatchObject({
      allowed: true,
      login: null
    });
  });

  it("denies requests that arrive without a tailscale identity", () => {
    expect(
      evaluateTailscaleAccess({
        config: {
          mode: "enforce",
          allowedUserLogins: ["miau"]
        },
        headers: {
          host: "gateway.tailnet.ts.net"
        }
      })
    ).toMatchObject({
      allowed: false,
      code: "tailscale_identity_missing"
    });
  });

  it("denies requests from non-allowlisted tailscale users", () => {
    expect(
      evaluateTailscaleAccess({
        config: {
          mode: "enforce",
          allowedUserLogins: ["miau"]
        },
        headers: {
          host: "gateway.tailnet.ts.net",
          "tailscale-user-login": "someone-else"
        }
      })
    ).toMatchObject({
      allowed: false,
      code: "tailscale_identity_denied",
      login: "someone-else"
    });
  });

  it("allows requests from the configured tailscale user", () => {
    expect(
      evaluateTailscaleAccess({
        config: {
          mode: "enforce",
          allowedUserLogins: ["miau"]
        },
        headers: {
          host: "gateway.tailnet.ts.net",
          "tailscale-user-login": "miau"
        }
      })
    ).toEqual({
      allowed: true,
      login: "miau"
    });
  });
});
