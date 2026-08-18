import { describe, expect, it } from 'vitest'

import { stubRuntimeConfig } from '~~/tests/helpers/nuxtGlobals'

stubRuntimeConfig('test-secret')
const { issueRoundToken, verifyRoundToken } = await import('./roundToken')

describe('issueRoundToken / verifyRoundToken', () => {
  it('round-trips: a freshly issued token verifies and carries the original data', () => {
    const { roundId, token, seed, startedAt } = issueRoundToken({ width: 800, height: 600 }, false)
    const payload = verifyRoundToken(token)

    expect(payload).not.toBeNull()
    expect(payload?.roundId).toBe(roundId)
    expect(payload?.seed).toBe(seed)
    expect(payload?.startedAt).toBe(startedAt)
    expect(payload?.w).toBe(800)
    expect(payload?.h).toBe(600)
    expect(payload?.bot).toBe(false)
  })

  it('carries the bot flag through', () => {
    const { token } = issueRoundToken({ width: 100, height: 100 }, true)
    expect(verifyRoundToken(token)?.bot).toBe(true)
  })

  it('issues a distinct roundId/token on every call', () => {
    const a = issueRoundToken({ width: 100, height: 100 }, false)
    const b = issueRoundToken({ width: 100, height: 100 }, false)
    expect(a.roundId).not.toBe(b.roundId)
    expect(a.token).not.toBe(b.token)
  })

  it('rejects a token whose payload was tampered with (signature no longer matches)', () => {
    const { token } = issueRoundToken({ width: 800, height: 600 }, false)
    const [json, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(json!, 'base64url').toString('utf8'))
    payload.w = 999999 // widen the bounds without re-signing
    const tamperedJson = Buffer.from(JSON.stringify(payload)).toString('base64url')

    expect(verifyRoundToken(`${tamperedJson}.${sig}`)).toBeNull()
  })

  it('rejects a token with a tampered signature', () => {
    const { token } = issueRoundToken({ width: 800, height: 600 }, false)
    const [json] = token.split('.')
    expect(verifyRoundToken(`${json}.not-a-real-signature`)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyRoundToken('')).toBeNull()
    expect(verifyRoundToken('no-dot-separator')).toBeNull()
    expect(verifyRoundToken('a.b.c')).toBeNull() // split('.') only keeps the first two parts as json/sig
    // @ts-expect-error deliberately passing a non-string to check the runtime guard
    expect(verifyRoundToken(null)).toBeNull()
  })

  it('rejects a token signed under a different secret', () => {
    // This is exactly what happens if the server process restarts between a
    // round starting and being submitted while using the random per-process
    // fallback secret (see nuxt.config.ts) — the token from the old process
    // must not verify against the new one.
    stubRuntimeConfig('secret-A')
    const { token } = issueRoundToken({ width: 800, height: 600 }, false)

    stubRuntimeConfig('secret-B')
    expect(verifyRoundToken(token)).toBeNull()

    stubRuntimeConfig('test-secret') // restore for any subsequent tests
  })
})
