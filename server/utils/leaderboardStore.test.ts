import { beforeEach, describe, expect, it } from 'vitest'

import { stubStorage } from '~~/tests/helpers/nuxtGlobals'

stubStorage()
const { getTop, sanitizeName, submitEntry, wouldQualify } = await import('./leaderboardStore')

describe('sanitizeName', () => {
  it('rejects non-string input', () => {
    expect(sanitizeName(undefined)).toBeNull()
    expect(sanitizeName(null)).toBeNull()
    expect(sanitizeName(42)).toBeNull()
    expect(sanitizeName({})).toBeNull()
  })

  it('rejects empty or whitespace-only names', () => {
    expect(sanitizeName('')).toBeNull()
    expect(sanitizeName('   ')).toBeNull()
    expect(sanitizeName('\t\n')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeName('  Martin  ')).toBe('Martin')
  })

  it('strips control characters, including embedded ones', () => {
    expect(sanitizeName('Mar\x00tin')).toBe('Martin')
    expect(sanitizeName('Martin\x7F')).toBe('Martin')
    expect(sanitizeName('\x1Bhack')).toBe('hack')
  })

  it('truncates to the max name length', () => {
    const result = sanitizeName('a'.repeat(50))
    expect(result).toHaveLength(16)
  })

  it('leaves ordinary unicode names intact', () => {
    expect(sanitizeName('José 🎮')).toBe('José 🎮')
  })
})

describe('leaderboard storage', () => {
  beforeEach(() => {
    stubStorage() // fresh in-memory store per test
  })

  it('getTop returns an empty array when nothing has been submitted', async () => {
    expect(await getTop()).toEqual([])
  })

  it('wouldQualify says yes for any score while fewer than 3 entries exist', async () => {
    expect(await wouldQualify(0)).toEqual({ qualifies: true, rank: 1 })
    await submitEntry({ name: 'A', clicks: 10, achievedAt: 1 })
    expect(await wouldQualify(0)).toEqual({ qualifies: true, rank: 2 })
  })

  it('submitEntry sorts by clicks desc, achievedAt asc as a tiebreaker', async () => {
    await submitEntry({ name: 'Low', clicks: 5, achievedAt: 1 })
    await submitEntry({ name: 'High', clicks: 20, achievedAt: 2 })
    await submitEntry({ name: 'Mid', clicks: 10, achievedAt: 3 })
    await submitEntry({ name: 'TieEarlier', clicks: 10, achievedAt: 1 })

    const top = await getTop(10)
    expect(top.map((e) => e.name)).toEqual(['High', 'TieEarlier', 'Mid', 'Low'])
  })

  it('once 3 entries exist, only a strictly better score qualifies', async () => {
    await submitEntry({ name: 'A', clicks: 30, achievedAt: 1 })
    await submitEntry({ name: 'B', clicks: 20, achievedAt: 2 })
    await submitEntry({ name: 'C', clicks: 10, achievedAt: 3 })

    expect(await wouldQualify(10)).toEqual({ qualifies: false, rank: -1 }) // ties don't beat
    expect(await wouldQualify(11)).toEqual({ qualifies: true, rank: 3 })
    expect(await wouldQualify(25)).toEqual({ qualifies: true, rank: 2 })
    expect(await wouldQualify(100)).toEqual({ qualifies: true, rank: 1 })
  })

  it('submitEntry reports the actual post-insert rank, re-checked rather than trusted', async () => {
    await submitEntry({ name: 'A', clicks: 30, achievedAt: 1 })
    await submitEntry({ name: 'B', clicks: 20, achievedAt: 2 })
    await submitEntry({ name: 'C', clicks: 10, achievedAt: 3 })

    const result = await submitEntry({ name: 'D', clicks: 25, achievedAt: 4 })
    expect(result).toEqual({ qualifies: true, rank: 2 })

    const missed = await submitEntry({ name: 'E', clicks: 1, achievedAt: 5 })
    expect(missed).toEqual({ qualifies: false, rank: -1 })
  })

  it('getTop respects the requested limit', async () => {
    for (let i = 0; i < 5; i++) {
      await submitEntry({ name: `p${i}`, clicks: i, achievedAt: i })
    }
    expect(await getTop(2)).toHaveLength(2)
  })

  it('keeps entries beyond the top 3 up to the buffer size, dropping the rest', async () => {
    /**
     * buffer size is 10; submit 12 distinct-score entries and confirm only
     * the best 10 survive.
     */
    for (let i = 0; i < 12; i++) {
      await submitEntry({ name: `p${i}`, clicks: i, achievedAt: i })
    }
    const top = await getTop(20)
    expect(top).toHaveLength(10)
    expect(top.map((e) => e.name)).toEqual([
      'p11',
      'p10',
      'p9',
      'p8',
      'p7',
      'p6',
      'p5',
      'p4',
      'p3',
      'p2',
    ])
  })
})
