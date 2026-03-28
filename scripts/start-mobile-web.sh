#!/bin/sh
set -eu

corepack pnpm --filter @codex-remote/mobile-web clean
exec corepack pnpm --filter @codex-remote/mobile-web exec next dev --hostname 127.0.0.1 --port 3000 "$@"
