import type { Bounds } from '#shared/evasionEngine'

const MIN_DIMENSION = 320
const MAX_DIMENSION = 10000

function clampDimension(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) {
    return MIN_DIMENSION
  }
  return Math.min(Math.max(n, MIN_DIMENSION), MAX_DIMENSION)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ width?: number; height?: number; webdriver?: boolean }>(
    event,
  ).catch(() => ({}) as { width?: number; height?: number; webdriver?: boolean })

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const allowed = await checkRateLimit(ip)
  if (!allowed) {
    throw createError({ statusCode: 429, statusMessage: 'Too many rounds started — slow down.' })
  }

  const bounds: Bounds = {
    width: clampDimension(body?.width),
    height: clampDimension(body?.height),
  }
  const bot = body?.webdriver === true

  const { roundId, token, seed, startedAt } = issueRoundToken(bounds, bot)

  return { roundId, token, seed, startedAt, bounds }
})
