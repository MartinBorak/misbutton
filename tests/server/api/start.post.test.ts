import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeEvent, stubServerApiBasics, stubStorage } from '~~/tests/helpers/nuxtGlobals'

stubServerApiBasics()

const { issueRoundToken } = await import('~~/server/utils/roundToken')
const { checkRateLimit } = await import('~~/server/utils/roundGuard')

vi.stubGlobal('issueRoundToken', issueRoundToken)
vi.stubGlobal('checkRateLimit', checkRateLimit)

function stubIp(ip: string) {
  vi.stubGlobal('getRequestIP', () => ip)
}

const handlerModule = await import('~~/server/api/round/start.post')
const handler = handlerModule.default as (event: unknown) => Promise<{
  roundId: string
  token: string
  seed: number
  startedAt: number
  bounds: { width: number; height: number }
}>

beforeEach(() => {
  stubStorage()
  stubIp('1.1.1.1')
})

describe('POST /api/round/start', () => {
  it('issues a round with the requested bounds', async () => {
    const result = await handler(fakeEvent({ width: 1024, height: 768 }))
    expect(result.bounds).toEqual({ width: 1024, height: 768 })
    expect(typeof result.roundId).toBe('string')
    expect(typeof result.token).toBe('string')
  })

  it('clamps dimensions below the minimum', async () => {
    const result = await handler(fakeEvent({ width: 10, height: 10 }))
    expect(result.bounds).toEqual({ width: 320, height: 320 })
  })

  it('clamps dimensions above the maximum', async () => {
    const result = await handler(fakeEvent({ width: 999_999, height: 999_999 }))
    expect(result.bounds).toEqual({ width: 10_000, height: 10_000 })
  })

  it('falls back to the minimum for non-finite/missing dimensions', async () => {
    const result = await handler(fakeEvent({}))
    expect(result.bounds).toEqual({ width: 320, height: 320 })
  })

  it('flags the round as bot when webdriver is reported true', async () => {
    const { token } = await handler(fakeEvent({ width: 500, height: 500, webdriver: true }))
    const { verifyRoundToken } = await import('~~/server/utils/roundToken')
    expect(verifyRoundToken(token)?.bot).toBe(true)
  })

  it('rate-limits repeated round starts from the same IP', async () => {
    for (let i = 0; i < 8; i++) {
      await handler(fakeEvent({ width: 500, height: 500 }))
    }
    await expect(handler(fakeEvent({ width: 500, height: 500 }))).rejects.toMatchObject({
      statusCode: 429,
      statusMessage: 'Too many rounds started — slow down.',
    })
  })

  it('tracks the rate limit per IP', async () => {
    for (let i = 0; i < 8; i++) {
      await handler(fakeEvent({ width: 500, height: 500 }))
    }
    stubIp('2.2.2.2')
    await expect(handler(fakeEvent({ width: 500, height: 500 }))).resolves.toBeDefined()
  })
})
