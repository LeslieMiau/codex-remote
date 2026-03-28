# Architecture

## Boundaries

- `apps/gateway` is the only network-facing process. It owns HTTP, WebSocket, and SSE protocol adaptation, but should delegate business rules to services and shared core helpers.
- `apps/mobile-web` talks only to the gateway. It does not read Codex native state directly.
- `packages/protocol` defines transport contracts and persisted entity schemas.
- `packages/core` owns shared runtime rules such as thread-state derivation, mirrored-thread projections, and materialized-control checks.

## Gateway Shape

- `runtime/codex-state-bridge.ts` reads and syncs native Codex state into gateway-safe read models.
- `services/read-model-service.ts` builds read views and fallback projections when native state is unavailable.
- `services/run-service.ts` coordinates run starts plus approval/native-request/patch lifecycle calls into `ThreadRuntimeManager`.
- `runtime/thread-runtime-manager.ts` keeps adapter execution, event publishing, and store updates in sync, while deferring state derivation to `packages/core`.

## Current Phase

- Phase 1 keeps HTTP and mobile-web behavior stable while reducing logic duplication between `server.ts`, `thread-runtime-manager.ts`, and mirrored-thread projections.
- SQLite schema and external API envelopes remain unchanged in this phase.
