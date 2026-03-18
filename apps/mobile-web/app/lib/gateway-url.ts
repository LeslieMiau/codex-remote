const DEFAULT_GATEWAY_BASE = "/api";
const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function trimTrailingSlash(value: string) {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function trimLeadingSlash(value: string) {
  return value.replace(/^\/+/, "");
}

function joinRelativePath(base: string, endpoint: string) {
  return `${trimTrailingSlash(base)}${normalizeEndpoint(endpoint)}`;
}

export function getGatewayBase(value = process.env.NEXT_PUBLIC_GATEWAY_URL) {
  const normalized = value?.trim();
  return normalized ? trimTrailingSlash(normalized) : DEFAULT_GATEWAY_BASE;
}

export function buildGatewayHttpUrl(base: string, endpoint: string) {
  if (ABSOLUTE_URL_PATTERN.test(base)) {
    return new URL(trimLeadingSlash(endpoint), `${trimTrailingSlash(base)}/`).toString();
  }
  return joinRelativePath(base, endpoint);
}

export function buildGatewayWsUrl(
  base: string,
  endpoint = "/ws",
  origin?: string
) {
  if (ABSOLUTE_URL_PATTERN.test(base)) {
    const url = new URL(trimLeadingSlash(endpoint), `${trimTrailingSlash(base)}/`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  const resolvedOrigin =
    origin ??
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://127.0.0.1:3000");
  const url = new URL(joinRelativePath(base, endpoint), resolvedOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
