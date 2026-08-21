import {
  simulateRound,
  TICK_MS,
  type Bounds,
  type HitEvent,
  type Vec2,
} from '#shared/evasionEngine'
import { ROUND_MS } from '#shared/roundConfig'

/** Allowed drift between expected and actual round duration — generous enough to absorb normal network/timer jitter. */
const ROUND_SLOP_MS = 5_000
/** ROUND_SLOP_MS expressed in ticks (2s of it), for comparison against the tick-counted sample array below. */
const TICK_SLOP = Math.round(2_000 / TICK_MS)
/**
 * Ceiling on cursor speed between two samples, in px/sec. Was 6,000, but
 * that was tight enough that ordinary fast mouse flicks while chasing the
 * button could exceed it and get flagged as implausible movement; raised to
 * 15,000 — confirmed against both realistic fast movement (passes) and
 * literal instant teleports (still rejected).
 */
const MAX_SPEED_PX_PER_SEC = 15_000
const MAX_PLAUSIBLE_CLICKS = Math.floor((ROUND_MS / 1000) * 8) // generous headroom above realistic play
/**
 * Slack on top of the exact reported bounds for the sample-out-of-bounds
 * check — real cursor positions can legitimately land slightly outside the
 * viewport (e.g. a resize racing with round start), so a 0px tolerance would
 * reject genuine play as cheating.
 */
const SAMPLE_BOUNDS_SLOP_PX = 50

interface SubmitBody {
  roundId?: string
  token?: string
  samples?: [number, number][]
  hits?: { tick: number; x: number; y: number }[]
}

interface ValidSubmitBody {
  roundId: string
  token: string
  samples: [number, number][]
  hits: { tick: number; x: number; y: number }[]
}

/** Whether a body has every field a submission needs. Narrows body's type when true. */
function isValidSubmitBody(body: SubmitBody): body is ValidSubmitBody {
  return Boolean(
    body.token && body.roundId && Array.isArray(body.samples) && Array.isArray(body.hits),
  )
}

/** Parses raw [x, y] tuples into Vec2s (no validation — see isEverySampleFinite/InBounds). */
function parseSamples(raw: [number, number][]): Vec2[] {
  return raw.map((s) => ({ x: Number(s?.[0]), y: Number(s?.[1]) }))
}

function isEverySampleFinite(samples: Vec2[]): boolean {
  return samples.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
}

function isEverySampleInBounds(samples: Vec2[], bounds: Bounds): boolean {
  return samples.every(
    (p) =>
      p.x >= -SAMPLE_BOUNDS_SLOP_PX &&
      p.y >= -SAMPLE_BOUNDS_SLOP_PX &&
      p.x <= bounds.width + SAMPLE_BOUNDS_SLOP_PX &&
      p.y <= bounds.height + SAMPLE_BOUNDS_SLOP_PX,
  )
}

/** Whether every step between consecutive samples is slower than any real cursor movement. */
function isMovementPlausible(samples: Vec2[]): boolean {
  const maxDistPerTick = (MAX_SPEED_PX_PER_SEC * TICK_MS) / 1000
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!
    const curr = samples[i]!
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > maxDistPerTick) {
      return false
    }
  }
  return true
}

/** Parses raw hit records into HitEvents (no validation — see isEveryHitValid). */
function parseHits(raw: { tick: number; x: number; y: number }[]): HitEvent[] {
  return raw.map((h) => ({ tick: Number(h?.tick), x: Number(h?.x), y: Number(h?.y) }))
}

function isEveryHitValid(hits: HitEvent[], sampleCount: number): boolean {
  return hits.every(
    (h) =>
      Number.isInteger(h.tick) &&
      h.tick >= 0 &&
      h.tick < sampleCount &&
      Number.isFinite(h.x) &&
      Number.isFinite(h.y),
  )
}

/** POST /api/round/submit — validates a completed round's recorded input and returns the verified score. */
export default defineEventHandler(async (event) => {
  const body = await readBodySafe<SubmitBody>(event)
  if (!isValidSubmitBody(body)) {
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

  const bounds: Bounds = { width: payload.w, height: payload.h }
  const samples = parseSamples(body.samples)
  if (!isEverySampleFinite(samples)) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed sample data.' })
  }
  if (!isEverySampleInBounds(samples, bounds)) {
    throw createError({ statusCode: 400, statusMessage: 'Sample out of bounds.' })
  }
  if (!isMovementPlausible(samples)) {
    throw createError({ statusCode: 400, statusMessage: 'Movement implausible.' })
  }

  if (body.hits.length > MAX_PLAUSIBLE_CLICKS) {
    throw createError({ statusCode: 400, statusMessage: 'Implausible click count.' })
  }
  const hits = parseHits(body.hits)
  if (!isEveryHitValid(hits, samples.length)) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed hit data.' })
  }

  const { clicks } = simulateRound({
    samples,
    hits,
    bounds,
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
