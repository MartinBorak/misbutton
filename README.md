# misbutton

A circular button that does not want to be clicked. You get 60 seconds; it dodges your cursor with a real reaction window, so cornering it against an edge is a genuine, learnable strategy — not a special case. Top 3 all-time scores are kept on a global leaderboard, ranked by clicks and then by who got there first.

Built with Nuxt 4 (Vue 3 + Nitro), no UI framework, no animation library.

## How the dodge works

The button's movement is a deterministic, seeded simulation (`shared/evasionEngine.ts`) that runs identically on the client (to render the game) and on the server (to replay-verify a submitted score). The client never gets to just claim a click count — it sends the raw cursor/click log, and the server recomputes the score itself by replaying it through the same engine. See the file for the exact mechanics (reaction delay, dodge cone, bounds clamping).

## Development

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # production build
pnpm preview    # preview the production build locally
```

Typecheck:

```bash
pnpm exec nuxi typecheck
```

## Leaderboard storage

Backed by Nitro's `useStorage()` abstraction (see `nuxt.config.ts`) — local dev uses the filesystem driver with no setup required. Switching to a real host's KV/Blob store later is a config change in `nuxt.config.ts`, not a code change.

Set `NUXT_ROUND_SECRET` in production if running more than one server instance, so round tokens issued by one instance verify on another.
