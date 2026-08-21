/**
 * Tracks single-use round tokens and a per-IP rate limit on starting rounds.
 * Backed by the "rounds" storage mount (nuxt.config.ts) — same swappable
 * unstorage abstraction as the leaderboard.
 */

/** Sliding window for the per-IP rate limit — 1 minute. Coincidentally equal to ROUND_MS, but unrelated to it. */
const RATE_LIMIT_WINDOW_MS = 60_000
/** Round starts allowed per IP per window — generous enough for legitimate replay attempts, low enough to blunt scripted abuse. */
const RATE_LIMIT_MAX = 8

/** The unstorage mount backing round usage/claim records and rate limits. */
function store() {
  return useStorage('rounds')
}

export interface RoundResult {
  usedAt: number
  clicks: number
  claimed: boolean
}

/** Looks up the recorded result for a round, if it's been submitted. */
export async function getRoundResult(roundId: string): Promise<RoundResult | null> {
  return (await store().getItem<RoundResult>(`used:${roundId}`)) ?? null
}

/** Records a round's final click count so it can only be submitted once. */
export async function markRoundUsed(roundId: string, clicks: number): Promise<void> {
  await store().setItem<RoundResult>(`used:${roundId}`, {
    usedAt: Date.now(),
    clicks,
    claimed: false,
  })
}

/** Marks a round's result as claimed onto the leaderboard, so it can't be claimed twice. */
export async function markRoundClaimed(roundId: string): Promise<void> {
  const existing = await getRoundResult(roundId)
  await store().setItem<RoundResult>(`used:${roundId}`, {
    usedAt: existing?.usedAt ?? Date.now(),
    clicks: existing?.clicks ?? 0,
    claimed: true,
  })
}

/** Returns true if the request is allowed, false if the caller is over the limit. */
export async function checkRateLimit(ip: string): Promise<boolean> {
  const key = `rate:${ip}`
  const now = Date.now()
  const existing = await store().getItem<{ count: number; windowStart: number }>(key)
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    await store().setItem(key, { count: 1, windowStart: now })
    return true
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return false
  }
  await store().setItem(key, { count: existing.count + 1, windowStart: existing.windowStart })
  return true
}
