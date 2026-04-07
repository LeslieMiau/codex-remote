#!/bin/sh
set -eu

web_mode="${CODEX_REMOTE_WEB_MODE:-start}"
web_host="${CODEX_REMOTE_WEB_HOST:-127.0.0.1}"
web_port="${CODEX_REMOTE_WEB_PORT:-3000}"

corepack pnpm --filter @codex-remote/mobile-web clean

if [ "$web_mode" = "dev" ]; then
  export WATCHPACK_POLLING="${WATCHPACK_POLLING:-true}"
  exec corepack pnpm --filter @codex-remote/mobile-web exec next dev --hostname "$web_host" --port "$web_port" "$@"
fi

corepack pnpm --filter @codex-remote/mobile-web build
exec corepack pnpm --filter @codex-remote/mobile-web exec next start --hostname "$web_host" --port "$web_port" "$@"
