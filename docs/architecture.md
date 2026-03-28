# Architecture

## Boundaries

- `apps/gateway` is the only network-facing process. It owns HTTP, WebSocket, and SSE protocol adaptation, but should delegate business rules to services and shared core helpers.
- `apps/mobile-web` talks only to the gateway. It does not read Codex native state directly.
- `packages/protocol` defines transport contracts and persisted entity schemas.
- `packages/core` owns shared runtime rules such as thread-state derivation, mirrored-thread projections, and materialized-control checks.

## Gateway Shape

- `runtime/codex-state-bridge.ts` reads and syncs native Codex state into gateway-safe read models.
- `repositories/gateway-repositories.ts` adapts `GatewayStore` into repository interfaces so application services stop reaching into SQLite details directly.
- `projections/fallback-thread-projection.ts` materializes degraded thread/timeline/transcript views from mirrored gateway data when native state is unavailable.
- `services/read-model-service.ts` builds read views by composing the native bridge with fallback projections.
- `services/run-service.ts` coordinates run starts plus approval/native-request/patch lifecycle calls into `ThreadRuntimeManager`, while reading conflict state through repositories.
- `runtime/thread-runtime-manager.ts` keeps adapter execution, event publishing, and store updates in sync, while deferring state derivation to `packages/core`.

## Current Phase

- Phase 1 keeps HTTP and mobile-web behavior stable while reducing logic duplication between `server.ts`, `thread-runtime-manager.ts`, and mirrored-thread projections.
- Phase 3 keeps the existing SQLite schema but introduces repository and projection seams so later store/projection refactors can proceed without changing HTTP contracts.
- SQLite schema and external API envelopes remain unchanged in this phase.

## Mobile Web Shape

- `shared-thread-workspace-screen-model.ts` owns shared thread-derived UI state that both refreshed and legacy workspaces can consume:
  composer gating, lead approval/native-request/patch selection, return-to-list copy, attachment capabilities, model labels, and degraded fallback detection.
- `shared-thread-request-sheet-controller.ts` owns approval/native-request sheet open-close memory plus user-input payload construction. New native requests reset answer defaults by request id instead of leaking answers from the previous request.
- `shared-thread-attachment-controller.ts` owns attachment sheet state, selected skills, and image upload lifecycle.
- `shared-thread-switcher-controller.ts` owns recent-chat loading, route restoration, list filtering/sorting, and thread switch actions. Both workspace variants now share this controller.
- `shared-thread-details-view-model.ts` owns details-sheet action enablement and sync-blocked copy.
- `shared-empty-state-presentation.ts` owns degraded/offline/loading empty-state copy used by overview, queue, and both workspace variants.

## Mobile Web Boundaries

- Refreshed and legacy workspaces should keep orchestration in the component shell, but move reusable derivation into screen-models, controllers, or presentation helpers.
- Controllers own ephemeral UI state and side-effect coordination.
- Screen-models own pure derivation from transcript/capabilities/settings into display state.
- Presentation helpers own copy and lightweight formatting that must stay consistent across screens.
- New runtime-side features should land in shared helpers first when both workspace variants need the same state interpretation.

## Acceptance Notes

- `apps/mobile-web/scripts/verify-smoke.mjs` is the preferred route/html/browser smoke entrypoint for compact mobile screens.
- In the current Codex desktop sandbox, browser launch can fail with Chromium MachPort permission errors even when HTTP routes and HTML markers pass. Treat this as an environment blocker, not an app regression, and record the exact Playwright error in `PROGRESS.md`.
- When gateway runtime verification hits SQLite `database is locked` under the shared `CODEX_HOME`, use an isolated `CODEX_HOME` for smoke checks instead of mutating the shared local state.
