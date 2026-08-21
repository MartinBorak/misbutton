import type { RoundPayload } from './roundToken'

/**
 * Verifies a submitted round token and that it belongs to the claimed round,
 * throwing the same 400 either way — submit and claim both gate on exactly
 * this, and a caller must never be able to tell a bad signature apart from a
 * mismatched roundId.
 */
export function requireRoundPayload(token: unknown, roundId: unknown): RoundPayload {
  const payload = verifyRoundToken(token)
  if (!payload || payload.roundId !== roundId) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid round token.' })
  }
  return payload
}
