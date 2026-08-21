import { beforeEach, describe, expect, it } from 'vitest'

import { stubStorage } from '~~/tests/helpers/nuxtGlobals'

stubStorage()
const { getTopEntries, submitEntry, wouldQualify } = await import('./leaderboardStore')

describe('leaderboard storage', () => {
  beforeEach(() => {
    stubStorage() // fresh in-memory store per test
  })

  it('getTopEntries returns an empty array when nothing has been submitted', async () => {
    expect(await getTopEntries()).toEqual([])
  })

  it('wouldQualify says yes for any score while fewer than 3 entries exist', async () => {
    expect(await wouldQualify(0)).toEqual({ qualifies: true, rank: 1 })
    await submitEntry({ name: 'A', clicks: 10, achievedAt: 1 })
    expect(await wouldQualify(0)).toEqual({ qualifies: true, rank: 2 })
  })

  it('wouldQualify ranks a score that beats an existing entry ahead of it, even while under 3 entries', async () => {
    await submitEntry({ name: 'A', clicks: 10, achievedAt: 1 })
    expect(await wouldQualify(20)).toEqual({ qualifies: true, rank: 1 })
  })

  it('submitEntry sorts by clicks desc, achievedAt asc as a tiebreaker', async () => {
    await submitEntry({ name: 'Low', clicks: 5, achievedAt: 1 })
    await submitEntry({ name: 'High', clicks: 20, achievedAt: 2 })
    await submitEntry({ name: 'Mid', clicks: 10, achievedAt: 3 })
    await submitEntry({ name: 'TieEarlier', clicks: 10, achievedAt: 1 })

    const top = await getTopEntries(10)
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

  it('getTopEntries respects the requested limit', async () => {
    for (let i = 0; i < 5; i++) {
      await submitEntry({ name: `p${i}`, clicks: i, achievedAt: i })
    }
    expect(await getTopEntries(2)).toHaveLength(2)
  })

  it('keeps entries beyond the top 3 up to the buffer size, dropping the rest', async () => {
    /**
     * buffer size is 10; submit 12 distinct-score entries and confirm only
     * the best 10 survive.
     */
    for (let i = 0; i < 12; i++) {
      await submitEntry({ name: `p${i}`, clicks: i, achievedAt: i })
    }
    const top = await getTopEntries(20)
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
