# codex-remote Working Notes

- Use the `pnpm` workspace layout. Shared contracts belong in `packages/protocol`; domain rules belong in `packages/core`.
- Keep the gateway as the only network-facing process. The Codex runtime kernel is `codex app-server` over stdio.
- Preserve the gateway protocol boundary. Mobile clients talk to the gateway, never directly to the app-server child.
- Default to one thread per worktree. Reuse the same worktree only for later turns in the same thread.
- Keep WebSocket as the primary stream transport and SSE as the read-only fallback.
- Ship security-first defaults: localhost binding, Tailscale Serve ingress only, no Funnel, no network access without approval.
- Prefer additive protocol changes. Removing or renaming envelope fields requires a compatibility plan.
