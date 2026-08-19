import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeEvent, stubServerApiBasics, stubStorage } from '~~/tests/helpers/nuxtGlobals'

stubServerApiBasics()

const { issueRoundToken, verifyRoundToken } = await import('~~/server/utils/roundToken')
const { getRoundResult, markRoundClaimed, markRoundUsed } =
  await import('~~/server/utils/roundGuard')
const { getTop, sanitizeName, submitEntry } = await import('~~/server/utils/leaderboardStore')

vi.stubGlobal('verifyRoundToken', verifyRoundToken)
vi.stubGlobal('getRoundResult', getRoundResult)
vi.stubGlobal('markRoundClaimed', markRoundClaimed)
vi.stubGlobal('sanitizeName', sanitizeName)
vi.stubGlobal('submitEntry', submitEntry)

const handlerModule = await import('~~/server/api/round/claim.post')
const handler = handlerModule.default as (event: unknown) => Promise<unknown>

const BOUNDS = { width: 1000, height: 800 }

beforeEach(() => {
  stubStorage()
})

describe('POST /api/round/claim', () => {
  it('rejects a malformed claim (missing fields)', async () => {
    await expect(handler(fakeEvent({}))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Malformed claim.',
    })
  })

  it('rejects an invalid token', async () => {
    await expect(
      handler(fakeEvent({ roundId: 'x', token: 'not-real', name: 'Martin' })),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid round token.' })
  })

  it('rejects bot-flagged sessions', async () => {
    const { roundId, token } = issueRoundToken(BOUNDS, true)
    await expect(handler(fakeEvent({ roundId, token, name: 'Martin' }))).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Automated sessions are not eligible for the leaderboard.',
    })
  })

  it('rejects claiming a round that was never submitted', async () => {
    const { roundId, token } = issueRoundToken(BOUNDS, false)
    await expect(handler(fakeEvent({ roundId, token, name: 'Martin' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Submit the round before claiming.',
    })
  })

  it('rejects claiming the same round twice', async () => {
    const { roundId, token } = issueRoundToken(BOUNDS, false)
    await markRoundUsed(roundId, 10)
    await handler(fakeEvent({ roundId, token, name: 'Martin' }))
    await expect(
      handler(fakeEvent({ roundId, token, name: 'Someone Else' })),
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Round already claimed.' })
  })

  it('rejects a name that sanitizes down to nothing', async () => {
    const { roundId, token } = issueRoundToken(BOUNDS, false)
    await markRoundUsed(roundId, 10)
    await expect(handler(fakeEvent({ roundId, token, name: '   ' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Name required.',
    })
  })

  it('claims a submitted round, records the entry, and marks it claimed', async () => {
    const { roundId, token } = issueRoundToken(BOUNDS, false)
    await markRoundUsed(roundId, 25)

    const result = (await handler(fakeEvent({ roundId, token, name: 'Martin' }))) as {
      qualifies: boolean
      rank: number
    }
    expect(result).toEqual({ qualifies: true, rank: 1 })

    const top = await getTop()
    expect(top[0]).toMatchObject({ name: 'Martin', clicks: 25 })

    const stored = await getRoundResult(roundId)
    expect(stored?.claimed).toBe(true)
  })
})
