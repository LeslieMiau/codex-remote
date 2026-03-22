#!/bin/sh
set -eu

exec corepack pnpm --filter @codex-remote/mobile-web dev "$@"
