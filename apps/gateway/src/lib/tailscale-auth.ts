export interface TailscaleAuthConfig {
  mode: "off" | "enforce";
  allowedUserLogins: string[];
}

export interface TailscaleRequestHeaders {
  host?: string | string[];
  "tailscale-user-login"?: string | string[];
}

export interface TailscaleAccessDecision {
  allowed: boolean;
  code?: "tailscale_identity_missing" | "tailscale_identity_denied";
  message?: string;
  login?: string | null;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

function coerceHeaderValue(value?: string | string[]): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function normalizeHost(hostHeader?: string | string[]): string | null {
  const rawHost = coerceHeaderValue(hostHeader)?.trim().toLowerCase();
  if (!rawHost) {
    return null;
  }

  if (rawHost.startsWith("[")) {
    const bracketEnd = rawHost.indexOf("]");
    if (bracketEnd === -1) {
      return rawHost;
    }
    return rawHost.slice(0, bracketEnd + 1);
  }

  const hostParts = rawHost.split(":");
  return hostParts[0] ?? rawHost;
}

export function readTailscaleAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): TailscaleAuthConfig {
  const allowedUserLogins = (env.CODEX_REMOTE_TAILSCALE_ALLOWED_USER_LOGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const modeValue = (env.CODEX_REMOTE_TAILSCALE_AUTH ??
    (allowedUserLogins.length > 0 ? "enforce" : "off"))
    .trim()
    .toLowerCase();

  return {
    mode: modeValue === "enforce" ? "enforce" : "off",
    allowedUserLogins
  };
}

export function evaluateTailscaleAccess(input: {
  config: TailscaleAuthConfig;
  headers: TailscaleRequestHeaders;
}): TailscaleAccessDecision {
  if (input.config.mode !== "enforce") {
    return {
      allowed: true,
      login: coerceHeaderValue(input.headers["tailscale-user-login"])
    };
  }

  const host = normalizeHost(input.headers.host);
  const login = coerceHeaderValue(input.headers["tailscale-user-login"])?.trim() ?? null;

  if (!login && host && LOOPBACK_HOSTS.has(host)) {
    return {
      allowed: true,
      login: null
    };
  }

  if (!login) {
    return {
      allowed: false,
      code: "tailscale_identity_missing",
      message:
        "Access denied. This gateway only accepts requests that arrive through Tailscale Serve with an attached user identity.",
      login: null
    };
  }

  if (!input.config.allowedUserLogins.includes(login)) {
    return {
      allowed: false,
      code: "tailscale_identity_denied",
      message: `Access denied. This gateway only allows the configured Tailscale user: ${input.config.allowedUserLogins.join(", ")}.`,
      login
    };
  }

  return {
    allowed: true,
    login
  };
}
