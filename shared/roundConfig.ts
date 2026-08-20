// Single source of truth for round duration — used identically by the
// client (countdown) and the server (submission timing/sample-count
// validation) so they never drift out of sync.
export const ROUND_MS = 60_000
