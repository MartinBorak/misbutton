/**
 * Read-modify-write wrapper over Nitro's storage abstraction (useStorage) —
 * nothing here references a driver by name, so switching hosts later is a
 * config-only change in nuxt.config.ts.
 */

import type { LeaderboardEntry } from '#shared/leaderboard'

const KEY = 'leaderboard:top'
const BUFFER_SIZE = 10
const TOP_N = 3
const MAX_NAME_LENGTH = 16

function store() {
  return useStorage('leaderboard')
}

function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries.toSorted((a, b) => b.clicks - a.clicks || a.achievedAt - b.achievedAt)
}

export async function getTopEntries(n = TOP_N): Promise<LeaderboardEntry[]> {
  const entries = (await store().getItem<LeaderboardEntry[]>(KEY)) ?? []
  return sortEntries(entries).slice(0, n)
}

export async function wouldQualify(clicks: number): Promise<{ qualifies: boolean; rank: number }> {
  const top = await getTopEntries(TOP_N)
  const beatIndex = top.findIndex((e) => clicks > e.clicks)
  if (beatIndex !== -1) {
    return { qualifies: true, rank: beatIndex + 1 }
  }
  if (top.length < TOP_N) {
    return { qualifies: true, rank: top.length + 1 }
  }
  return { qualifies: false, rank: -1 }
}

/**
 * Persists a new entry and returns whether it actually landed in the top N
 * (re-checked here, not trusted from an earlier wouldQualify call, to avoid a
 * race between two players finishing close together).
 */
export async function submitEntry(
  entry: LeaderboardEntry,
): Promise<{ qualifies: boolean; rank: number }> {
  const existing = (await store().getItem<LeaderboardEntry[]>(KEY)) ?? []
  const updated = sortEntries([...existing, entry]).slice(0, BUFFER_SIZE)
  await store().setItem(KEY, updated)
  const rank = updated.slice(0, TOP_N).indexOf(entry)
  return { qualifies: rank !== -1, rank: rank === -1 ? -1 : rank + 1 }
}

function isControlCharCode(code: number): boolean {
  return code < 32 || code === 127
}

export function sanitizeName(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }
  let visible = ''
  for (const char of input) {
    if (!isControlCharCode(char.codePointAt(0) || 0)) {
      visible += char
    }
  }
  const cleaned = visible.trim().slice(0, MAX_NAME_LENGTH)
  return cleaned.length > 0 ? cleaned : null
}
