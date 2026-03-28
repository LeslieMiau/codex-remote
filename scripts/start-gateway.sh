#!/bin/sh
set -eu

export CODEX_REMOTE_GATEWAY_HOST="${CODEX_REMOTE_GATEWAY_HOST:-127.0.0.1}"
export CODEX_REMOTE_GATEWAY_PORT="${CODEX_REMOTE_GATEWAY_PORT:-8787}"

corepack pnpm --filter @codex-remote/gateway build
exec corepack pnpm --filter @codex-remote/gateway start "$@"
