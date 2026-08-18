// Single source of truth for round duration — used identically by the
// client (countdown) and the server (submission timing/sample-count
// validation) so they never drift out of sync. Short in dev so playtesting
// doesn't require sitting through a full round; full length in prod.
export const ROUND_MS = import.meta.dev ? 5_000 : 60_000
