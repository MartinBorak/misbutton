import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeEvent, stubDefineEventHandler, stubStorage } from '~~/tests/helpers/nuxtGlobals'

stubDefineEventHandler()
stubStorage()

const { getTopEntries, submitEntry } = await import('~~/server/utils/leaderboardStore')
vi.stubGlobal('getTopEntries', getTopEntries)

const handlerModule = await import('~~/server/api/leaderboard/top.get')
const handler = handlerModule.default as (event: unknown) => Promise<{ entries: unknown[] }>

beforeEach(() => {
  stubStorage()
})

describe('GET /api/leaderboard/top', () => {
  it('returns an empty list when nobody has scored yet', async () => {
    expect(await handler(fakeEvent(undefined))).toEqual({ entries: [] })
  })

  it('returns the current top entries', async () => {
    await submitEntry({ name: 'Martin', clicks: 10, achievedAt: 1 })
    const { entries } = await handler(fakeEvent(undefined))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Martin', clicks: 10 })
  })
})
