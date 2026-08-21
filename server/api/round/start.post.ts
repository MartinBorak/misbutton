import type { Bounds } from '#shared/evasionEngine'

interface StartBody {
  width?: number
  height?: number
  webdriver?: boolean
}

/** Floor for a reported viewport dimension — well below any real device, just guards against a 0/negative/absurd report. */
const MIN_DIMENSION = 320
/** Ceiling for a reported viewport dimension — well above any real display, just guards against a spoofed/absurd report. */
const MAX_DIMENSION = 10000

/** Clamps a reported viewport dimension into a sane range. */
function clampDimension(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) {
    return MIN_DIMENSION
  }
  return Math.min(Math.max(n, MIN_DIMENSION), MAX_DIMENSION)
}

/** POST /api/round/start — issues a signed round token and returns the seed/bounds to start a round with. */
export default defineEventHandler(async (event) => {
  const body = await readBody<StartBody>(event).catch(() => ({}) as StartBody)

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const allowed = await checkRateLimit(ip)
  if (!allowed) {
    throw createError({ statusCode: 429, statusMessage: 'Too many rounds started — slow down.' })
  }

  const bounds: Bounds = {
    width: clampDimension(body.width),
    height: clampDimension(body.height),
  }
  const bot = body.webdriver === true

  const { roundId, token, seed, startedAt } = issueRoundToken(bounds, bot)

  return { roundId, token, seed, startedAt, bounds }
})
