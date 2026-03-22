#!/bin/sh
set -eu

exec corepack pnpm --filter @codex-remote/gateway dev "$@"
