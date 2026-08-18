import { beforeEach, describe, expect, it, vi } from 'vitest'

import { stubStorage } from '~~/tests/helpers/nuxtGlobals'

stubStorage()
const { checkRateLimit, getRoundResult, markRoundClaimed, markRoundUsed } =
  await import('./roundGuard')

describe('round result tracking', () => {
  beforeEach(() => {
    stubStorage()
  })

  it('returns null for a round that has never been submitted', async () => {
    expect(await getRoundResult('unknown')).toBeNull()
  })

  it('markRoundUsed records the click count, unclaimed', async () => {
    await markRoundUsed('round-1', 42)
    const result = await getRoundResult('round-1')
    expect(result?.clicks).toBe(42)
    expect(result?.claimed).toBe(false)
    expect(typeof result?.usedAt).toBe('number')
  })

  it('markRoundClaimed flips claimed to true without losing the recorded clicks', async () => {
    await markRoundUsed('round-1', 42)
    await markRoundClaimed('round-1')
    const result = await getRoundResult('round-1')
    expect(result?.claimed).toBe(true)
    expect(result?.clicks).toBe(42)
  })

  it('markRoundClaimed on an unsubmitted round still records something sane', async () => {
    // claim.post.ts guards against this in practice (it requires an existing
    // result), but the util itself shouldn't produce garbage if called cold.
    await markRoundClaimed('never-submitted')
    const result = await getRoundResult('never-submitted')
    expect(result?.claimed).toBe(true)
    expect(result?.clicks).toBe(0)
  })
})

describe('checkRateLimit', () => {
  beforeEach(() => {
    stubStorage()
    vi.useRealTimers()
  })

  it('allows requests up to the max within the window', async () => {
    for (let i = 0; i < 8; i++) {
      expect(await checkRateLimit('1.2.3.4')).toBe(true)
    }
  })

  it('blocks the request once the max is exceeded within the window', async () => {
    for (let i = 0; i < 8; i++) {
      await checkRateLimit('1.2.3.4')
    }
    expect(await checkRateLimit('1.2.3.4')).toBe(false)
  })

  it('tracks each IP independently', async () => {
    for (let i = 0; i < 8; i++) {
      await checkRateLimit('1.1.1.1')
    }
    expect(await checkRateLimit('1.1.1.1')).toBe(false)
    expect(await checkRateLimit('2.2.2.2')).toBe(true)
  })

  it('resets the count once the window has passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    for (let i = 0; i < 8; i++) {
      await checkRateLimit('9.9.9.9')
    }
    expect(await checkRateLimit('9.9.9.9')).toBe(false)

    vi.setSystemTime(60_001) // just past RATE_LIMIT_WINDOW_MS
    expect(await checkRateLimit('9.9.9.9')).toBe(true)
    vi.useRealTimers()
  })
})
