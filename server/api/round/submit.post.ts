import { simulateRound, TICK_MS, type HitEvent, type Vec2 } from '#shared/evasionEngine'
import { ROUND_MS } from '#shared/roundConfig'

const ROUND_SLOP_MS = Math.min(5_000, Math.round(ROUND_MS * 0.5))
const TICK_SLOP = Math.round(2_000 / TICK_MS)
const MAX_SPEED_PX_PER_SEC = 15_000
const MAX_PLAUSIBLE_CLICKS = Math.floor((ROUND_MS / 1000) * 8) // generous headroom above realistic play

interface SubmitBody {
  roundId?: string
  token?: string
  samples?: [number, number][]
  hits?: { tick: number; x: number; y: number }[]
}

/** POST /api/round/submit — validates a completed round's recorded input and returns the verified score. */
export default defineEventHandler(async (event) => {
  const body = await readBody<SubmitBody>(event).catch(() => ({}) as SubmitBody)

  if (!body.token || !body.roundId || !Array.isArray(body.samples) || !Array.isArray(body.hits)) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed submission.' })
  }

  const payload = verifyRoundToken(body.token)
  if (!payload || payload.roundId !== body.roundId) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid round token.' })
  }

  if (await getRoundResult(payload.roundId)) {
    throw createError({ statusCode: 409, statusMessage: 'Round already submitted.' })
  }

  const elapsed = Date.now() - payload.startedAt
  if (elapsed < ROUND_MS - ROUND_SLOP_MS || elapsed > ROUND_MS + ROUND_SLOP_MS) {
    throw createError({ statusCode: 400, statusMessage: 'Round timing invalid.' })
  }

  const expectedTicks = Math.round(ROUND_MS / TICK_MS)
  if (Math.abs(body.samples.length - expectedTicks) > TICK_SLOP) {
    throw createError({ statusCode: 400, statusMessage: 'Sample count invalid.' })
  }

  const samples: Vec2[] = body.samples.map((s) => ({ x: Number(s?.[0]), y: Number(s?.[1]) }))
  if (samples.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed sample data.' })
  }
  if (samples.some((p) => p.x < -50 || p.y < -50 || p.x > payload.w + 50 || p.y > payload.h + 50)) {
    throw createError({ statusCode: 400, statusMessage: 'Sample out of bounds.' })
  }

  const maxDistPerTick = (MAX_SPEED_PX_PER_SEC * TICK_MS) / 1000
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!
    const curr = samples[i]!
    const d = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    if (d > maxDistPerTick) {
      throw createError({ statusCode: 400, statusMessage: 'Movement implausible.' })
    }
  }

  if (body.hits.length > MAX_PLAUSIBLE_CLICKS) {
    throw createError({ statusCode: 400, statusMessage: 'Implausible click count.' })
  }

  const hits: HitEvent[] = body.hits.map((h) => ({
    tick: Number(h?.tick),
    x: Number(h?.x),
    y: Number(h?.y),
  }))
  if (
    hits.some(
      (h) =>
        !Number.isInteger(h.tick) ||
        h.tick < 0 ||
        h.tick >= samples.length ||
        !Number.isFinite(h.x) ||
        !Number.isFinite(h.y),
    )
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed hit data.' })
  }

  const { clicks } = simulateRound({
    samples,
    hits,
    bounds: { width: payload.w, height: payload.h },
    seed: payload.seed,
    /**
     * Must match useDodgingButton.ts's start() — the round now begins with
     * the button at screen center (where the idle button rested) rather
     * than a random seed-derived position.
     */
    initialCenter: { x: payload.w / 2, y: payload.h / 2 },
  })

  await markRoundUsed(payload.roundId, clicks)

  if (payload.bot) {
    return { clicks, qualifies: false, rank: -1, flagged: true }
  }

  const { qualifies, rank } = await wouldQualify(clicks)
  return { clicks, qualifies, rank }
})
