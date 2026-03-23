# codex-remote Working Notes

## Delivery Workflow

- After every feature or bugfix change, always complete the flow in this order: `1. verify 2. commit 3. push`.
- Verification is required before commit. Run the relevant local checks and a real runtime sanity check for the affected flow so we catch regressions like mobile-web `500` errors before pushing.
- Do not stop after commit. Once verification passes, commit the change and push it to `origin/main` in the same turn unless the user explicitly says not to.

- Use the `pnpm` workspace layout. Shared contracts belong in `packages/protocol`; domain rules belong in `packages/core`.
- Keep the gateway as the only network-facing process. The Codex runtime kernel is `codex app-server` over stdio.
- Preserve the gateway protocol boundary. Mobile clients talk to the gateway, never directly to the app-server child.
- Default to one thread per worktree. Reuse the same worktree only for later turns in the same thread.
- Keep WebSocket as the primary stream transport and SSE as the read-only fallback.
- Ship security-first defaults: localhost binding, Tailscale Serve ingress only, no Funnel, no network access without approval.
- Prefer additive protocol changes. Removing or renaming envelope fields requires a compatibility plan.
