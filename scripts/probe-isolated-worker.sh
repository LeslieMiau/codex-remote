#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${1:-}" = "--" ]; then
  shift
fi

worker_id="${1:-${ISOLATED_WORKER_ID:-3}}"
gateway_host="${CODEX_REMOTE_GATEWAY_HOST:-127.0.0.1}"
gateway_port="${CODEX_REMOTE_GATEWAY_PORT:-8787}"
web_host="${CODEX_REMOTE_WEB_HOST:-127.0.0.1}"
web_port="${CODEX_REMOTE_WEB_PORT:-3000}"
report_dir="${CODEX_REMOTE_PROBE_OUTPUT_DIR:-output/isolated-worker-probes}"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
timestamp_slug="$(date -u +"%Y%m%dT%H%M%SZ")"

mkdir -p "$report_dir"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-remote-probe-${worker_id}.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

gateway_health_body="$tmp_dir/gateway-health.json"
overview_body="$tmp_dir/mobile-overview.json"
diagnostics_body="$tmp_dir/diagnostics-summary.json"
report_path="$report_dir/worker-${worker_id}-${timestamp_slug}.json"

curl_status() {
  local output_path="$1"
  local url="$2"
  local method="${3:-GET}"
  local status

  status="$(
    curl --silent --show-error --output "$output_path" --write-out "%{http_code}" \
      --request "$method" "$url" 2>"$tmp_dir/curl-stderr.log" || printf '000'
  )"
  printf '%s' "$status"
}

gateway_health_status="$(
  curl_status "$gateway_health_body" "http://${gateway_host}:${gateway_port}/health"
)"
overview_status="$(
  curl_status "$overview_body" "http://${web_host}:${web_port}/api/overview"
)"
diagnostics_status="$(
  curl_status "$diagnostics_body" "http://${gateway_host}:${gateway_port}/diagnostics/summary"
)"
projects_status="$(
  curl --silent --show-error --output /dev/null --write-out "%{http_code}" \
    --request HEAD "http://${web_host}:${web_port}/projects" 2>/dev/null || printf '000'
)"

git_status_path="$tmp_dir/git-status.txt"
git status --short >"$git_status_path"
git_branch="$(git branch --show-current)"
git_head="$(git rev-parse HEAD)"

export WORKER_ID="$worker_id"
export PROBE_TIMESTAMP="$timestamp"
export GIT_BRANCH="$git_branch"
export GIT_HEAD="$git_head"
export REPORT_PATH="$report_path"
export GATEWAY_HEALTH_STATUS="$gateway_health_status"
export OVERVIEW_STATUS="$overview_status"
export DIAGNOSTICS_STATUS="$diagnostics_status"
export PROJECTS_STATUS="$projects_status"
export GATEWAY_HEALTH_BODY_PATH="$gateway_health_body"
export OVERVIEW_BODY_PATH="$overview_body"
export DIAGNOSTICS_BODY_PATH="$diagnostics_body"
export GIT_STATUS_PATH="$git_status_path"
export GATEWAY_URL="http://${gateway_host}:${gateway_port}"
export WEB_URL="http://${web_host}:${web_port}"

node <<'NODE'
const fs = require("node:fs");

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJson(filePath) {
  const raw = readText(filePath).trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { parse_error: true, raw };
  }
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const gatewayHealth = readJson(process.env.GATEWAY_HEALTH_BODY_PATH);
const overview = readJson(process.env.OVERVIEW_BODY_PATH);
const diagnostics = readJson(process.env.DIAGNOSTICS_BODY_PATH);
const gitStatus = readText(process.env.GIT_STATUS_PATH)
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean);

const overviewCapabilities =
  overview && typeof overview === "object" && !Array.isArray(overview)
    ? overview.capabilities ?? {}
    : {};
const diagnosticsErrors =
  diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics)
    ? diagnostics.errors ?? {}
    : {};

const overallOk =
  asNumber(process.env.GATEWAY_HEALTH_STATUS) === 200 &&
  asNumber(process.env.OVERVIEW_STATUS) === 200 &&
  asNumber(process.env.DIAGNOSTICS_STATUS) === 200 &&
  asNumber(process.env.PROJECTS_STATUS) === 200;

const report = {
  probe: {
    worker_id: process.env.WORKER_ID,
    timestamp: process.env.PROBE_TIMESTAMP,
    report_path: process.env.REPORT_PATH
  },
  git: {
    branch: process.env.GIT_BRANCH,
    head: process.env.GIT_HEAD,
    dirty_paths: gitStatus
  },
  gateway: {
    base_url: process.env.GATEWAY_URL,
    health_status: asNumber(process.env.GATEWAY_HEALTH_STATUS),
    ok: asNumber(process.env.GATEWAY_HEALTH_STATUS) === 200,
    adapter:
      gatewayHealth && typeof gatewayHealth === "object" && !Array.isArray(gatewayHealth)
        ? gatewayHealth.adapter ?? null
        : null
  },
  mobile_web: {
    base_url: process.env.WEB_URL,
    overview_status: asNumber(process.env.OVERVIEW_STATUS),
    projects_head_status: asNumber(process.env.PROJECTS_STATUS),
    ok:
      asNumber(process.env.OVERVIEW_STATUS) === 200 &&
      asNumber(process.env.PROJECTS_STATUS) === 200,
    shared_state_available: Boolean(overviewCapabilities.shared_state_available),
    codex_home:
      typeof overviewCapabilities.codex_home === "string" ? overviewCapabilities.codex_home : null,
    thread_count: Array.isArray(overview?.threads) ? overview.threads.length : null
  },
  diagnostics: {
    status: asNumber(process.env.DIAGNOSTICS_STATUS),
    ok: asNumber(process.env.DIAGNOSTICS_STATUS) === 200,
    account_type:
      diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics)
        ? diagnostics.account?.type ?? null
        : null,
    mcp_server_count:
      diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics)
        ? Array.isArray(diagnostics.mcp_servers)
          ? diagnostics.mcp_servers.length
          : 0
        : 0,
    errors: diagnosticsErrors
  },
  overall_ok: overallOk
};

fs.writeFileSync(process.env.REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!overallOk) {
  process.exitCode = 1;
}
NODE
