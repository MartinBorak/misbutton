import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeEvent, stubServerApiBasics, stubStorage } from '~~/tests/helpers/nuxtGlobals'

// submit.post.ts's `export default defineEventHandler(...)` runs at import
// time, so defineEventHandler must be stubbed before that import happens.
stubServerApiBasics()

const { issueRoundToken, verifyRoundToken } = await import('~~/server/utils/roundToken')
const { getRoundResult, markRoundUsed } = await import('~~/server/utils/roundGuard')
const { wouldQualify } = await import('~~/server/utils/leaderboardStore')

// submit.post.ts calls these as bare globals too (Nitro server auto-imports
// every export under server/utils/**), so they need the same treatment as
// defineEventHandler/readBody/createError above.
vi.stubGlobal('verifyRoundToken', verifyRoundToken)
vi.stubGlobal('getRoundResult', getRoundResult)
vi.stubGlobal('markRoundUsed', markRoundUsed)
vi.stubGlobal('wouldQualify', wouldQualify)

const handlerModule = await import('~~/server/api/round/submit.post')
const handler = handlerModule.default as (event: unknown) => Promise<unknown>

const TICK_MS = 50
const ROUND_MS = 60_000 // import.meta.dev is false under plain vitest — see roundConfig.test.ts
const EXPECTED_TICKS = Math.round(ROUND_MS / TICK_MS)
const BOUNDS = { width: 1000, height: 800 }

/** A full round's worth of samples drifting gently, well within any plausible-movement limit. */
function calmSamples(count = EXPECTED_TICKS): [number, number][] {
  return Array.from({ length: count }, (_, i) => [
    500 + Math.sin(i / 40) * 50,
    400 + Math.cos(i / 40) * 50,
  ])
}

async function startRound(bot = false) {
  vi.setSystemTime(0)
  return issueRoundToken(BOUNDS, bot)
}

function submitAt(elapsedMs: number, body: Record<string, unknown>) {
  vi.setSystemTime(elapsedMs)
  return handler(fakeEvent(body))
}

beforeEach(() => {
  stubStorage()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/round/submit — input validation', () => {
  it('rejects a malformed submission (missing fields)', async () => {
    await expect(submitAt(ROUND_MS, {})).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Malformed submission.',
    })
  })

  it('rejects an invalid/garbage token', async () => {
    await expect(
      submitAt(ROUND_MS, {
        roundId: 'whatever',
        token: 'not-a-real-token',
        samples: [],
        hits: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid round token.' })
  })

  it('rejects a token/roundId mismatch', async () => {
    const { token } = await startRound()
    await expect(
      submitAt(ROUND_MS, { roundId: 'not-the-real-id', token, samples: [], hits: [] }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid round token.' })
  })

  it('rejects a round that was already submitted', async () => {
    const { roundId, token } = await startRound()
    const body = { roundId, token, samples: calmSamples(), hits: [] }
    await submitAt(ROUND_MS, body)
    await expect(submitAt(ROUND_MS, body)).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Round already submitted.',
    })
  })

  it('rejects submitting far too early', async () => {
    const { roundId, token } = await startRound()
    await expect(
      submitAt(1_000, { roundId, token, samples: calmSamples(), hits: [] }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Round timing invalid.' })
  })

  it('rejects submitting far too late', async () => {
    const { roundId, token } = await startRound()
    await expect(
      submitAt(ROUND_MS + 30_000, { roundId, token, samples: calmSamples(), hits: [] }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Round timing invalid.' })
  })

  it('rejects a sample count far off the expected tick total', async () => {
    const { roundId, token } = await startRound()
    await expect(
      submitAt(ROUND_MS, { roundId, token, samples: calmSamples(10), hits: [] }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Sample count invalid.' })
  })

  it('rejects non-numeric sample data', async () => {
    const { roundId, token } = await startRound()
    const samples = calmSamples()
    samples[5] = ['not', 'numeric'] as unknown as [number, number]
    await expect(submitAt(ROUND_MS, { roundId, token, samples, hits: [] })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Malformed sample data.',
    })
  })

  it('rejects a sample well outside the reported bounds', async () => {
    const { roundId, token } = await startRound()
    const samples = calmSamples()
    samples[5] = [100_000, 400]
    await expect(submitAt(ROUND_MS, { roundId, token, samples, hits: [] })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Sample out of bounds.',
    })
  })

  it('rejects an implausible click count', async () => {
    const { roundId, token } = await startRound()
    const hits = Array.from({ length: 1000 }, (_, i) => ({ tick: i % 100, x: 500, y: 400 }))
    await expect(
      submitAt(ROUND_MS, { roundId, token, samples: calmSamples(), hits }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Implausible click count.' })
  })

  it('rejects malformed hit data (tick out of range)', async () => {
    const { roundId, token } = await startRound()
    await expect(
      submitAt(ROUND_MS, {
        roundId,
        token,
        samples: calmSamples(),
        hits: [{ tick: EXPECTED_TICKS + 500, x: 500, y: 400 }],
      }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Malformed hit data.' })
  })
})

describe('POST /api/round/submit — movement plausibility', () => {
  // Regression coverage for the false-positive rejection fixed this session:
  // MAX_SPEED_PX_PER_SEC was 6,000 (300px/tick), tight enough that an
  // ordinary fast flick while chasing the button could trip it. It's now
  // 15,000 (750px/tick).
  it('accepts a fast but realistic single-tick flick (700px, under the 750px/tick cap)', async () => {
    const { roundId, token } = await startRound()
    const samples = calmSamples()
    samples[5] = [200, 400]
    samples[6] = [200 + 700, 400] // 700px in one 50ms tick, still within bounds
    const result = (await submitAt(ROUND_MS, { roundId, token, samples, hits: [] })) as {
      clicks: number
    }
    expect(result.clicks).toBe(0)
  })

  it('still rejects a genuinely implausible jump (900px in one tick)', async () => {
    const { roundId, token } = await startRound()
    const samples = calmSamples()
    samples[5] = [100, 400]
    samples[6] = [100 + 900, 400]
    await expect(submitAt(ROUND_MS, { roundId, token, samples, hits: [] })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Movement implausible.',
    })
  })
})

describe('POST /api/round/submit — success path', () => {
  it('accepts a valid submission and returns the qualification result', async () => {
    const { roundId, token } = await startRound()
    const result = (await submitAt(ROUND_MS, {
      roundId,
      token,
      samples: calmSamples(),
      hits: [],
    })) as { clicks: number; qualifies: boolean; rank: number }

    expect(result.clicks).toBe(0)
    expect(result.qualifies).toBe(true) // leaderboard is empty, so any score qualifies
    expect(result.rank).toBe(1)
  })

  it('flags bot-tagged rounds instead of scoring them', async () => {
    const { roundId, token } = await startRound(true)
    const result = (await submitAt(ROUND_MS, {
      roundId,
      token,
      samples: calmSamples(),
      hits: [],
    })) as { clicks: number; qualifies: boolean; rank: number; flagged: boolean }

    expect(result).toEqual({ clicks: 0, qualifies: false, rank: -1, flagged: true })
  })
})
