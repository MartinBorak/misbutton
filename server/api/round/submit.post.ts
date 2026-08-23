import {
  simulateRound,
  TICK_MS,
  type Bounds,
  type HitEvent,
  type Vec2,
} from '#shared/evasionEngine'
import { MAX_OVERHANG_ABOVE_PX, MAX_OVERHANG_BELOW_PX } from '#shared/layout'
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

/**
 * Logs why a submission was rejected, then throws it.
 *
 * A rejection costs a player the full minute they just spent, and the
 * response tells them only that it failed — so without this, a report of
 * "it lost my score" can't be answered without reproducing it first. One
 * function, so a check added later can't quietly skip the log. The prefix
 * is there to filter on in the platform logs.
 */
function reject(statusCode: number, reason: string, detail?: Record<string, unknown>): never {
  console.warn('[round:rejected]', JSON.stringify({ reason, ...detail }))
  throw createError({ statusCode, statusMessage: reason })
}

/** Parses raw [x, y] tuples into Vec2s (no validation — see isEverySampleFinite/InBounds). */
function parseSamples(raw: [number, number][]): Vec2[] {
  return raw.map((s) => ({ x: Number(s?.[0]), y: Number(s?.[1]) }))
}

/** Whether every sample parsed to real numbers (guards against NaN from malformed input). */
function isEverySampleFinite(samples: Vec2[]): boolean {
  return samples.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
}

/**
 * Whether every sample sits somewhere the cursor could really have been.
 *
 * Not simply "inside the round's bounds": the bounds describe the arena,
 * which is inset from the window by the HUD band above and the footer band
 * below (see #shared/layout), while the cursor is free to roam the whole
 * window. Samples are recorded in arena coordinates, so a player who drifts
 * up over the leaderboard legitimately reports a negative y. Vertically the
 * allowance is therefore a band's worth of overhang on each side; the arena
 * spans the full window width, so horizontally it stays just the slop.
 */
function isEverySampleInBounds(samples: Vec2[], bounds: Bounds): boolean {
  return samples.every(
    (p) =>
      p.x >= -SAMPLE_BOUNDS_SLOP_PX &&
      p.x <= bounds.width + SAMPLE_BOUNDS_SLOP_PX &&
      p.y >= -(MAX_OVERHANG_ABOVE_PX + SAMPLE_BOUNDS_SLOP_PX) &&
      p.y <= bounds.height + MAX_OVERHANG_BELOW_PX + SAMPLE_BOUNDS_SLOP_PX,
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

/** Whether every hit carries a real coordinate and an in-range integer tick. */
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
    reject(400, 'Malformed submission.')
  }

  const payload = requireRoundPayload(body.token, body.roundId)
  /** Included in every rejection below, so a log line says which round it was. */
  const roundId = payload.roundId

  if (await getRoundResult(payload.roundId)) {
    reject(409, 'Round already submitted.', { roundId })
  }

  const elapsed = Date.now() - payload.startedAt
  if (elapsed < ROUND_MS - ROUND_SLOP_MS || elapsed > ROUND_MS + ROUND_SLOP_MS) {
    reject(400, 'Round timing invalid.', { roundId, elapsedMs: elapsed, expectedMs: ROUND_MS })
  }

  const expectedTicks = Math.round(ROUND_MS / TICK_MS)
  if (Math.abs(body.samples.length - expectedTicks) > TICK_SLOP) {
    reject(400, 'Sample count invalid.', {
      roundId,
      samples: body.samples.length,
      expected: expectedTicks,
    })
  }

  const bounds: Bounds = { width: payload.w, height: payload.h }
  const samples = parseSamples(body.samples)
  if (!isEverySampleFinite(samples)) {
    reject(400, 'Malformed sample data.', { roundId })
  }
  if (!isEverySampleInBounds(samples, bounds)) {
    reject(400, 'Sample out of bounds.', { roundId, bounds })
  }
  if (!isMovementPlausible(samples)) {
    reject(400, 'Movement implausible.', { roundId })
  }

  if (body.hits.length > MAX_PLAUSIBLE_CLICKS) {
    reject(400, 'Implausible click count.', { roundId, hits: body.hits.length })
  }
  const hits = parseHits(body.hits)
  if (!isEveryHitValid(hits, samples.length)) {
    reject(400, 'Malformed hit data.', { roundId })
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
