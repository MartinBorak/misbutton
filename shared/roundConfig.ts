/**
 * Single source of truth for round duration — used identically by the
 * client (countdown) and the server (submission timing/sample-count
 * validation) so they never drift out of sync. 60 seconds: long enough for
 * a real attempt, short enough to keep a round quick.
 */
export const ROUND_MS = 60_000
