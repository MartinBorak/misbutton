// Pure, DOM-free deterministic simulation of the dodging button.
// Used identically by the client (real-time rendering) and the server
// (replay verification of a submitted round) — see server/api/round/submit.post.ts.

export interface Vec2 {
  x: number
  y: number
}

export interface Bounds {
  width: number
  height: number
}

export interface HitEvent {
  /** Simulation tick at which the pointerdown occurred (see EvasionEngine.testHit). */
  tick: number
  x: number
  y: number
}

export interface EngineConfig {
  tickMs: number
  /** Base button radius, as a fraction of the smaller bounds dimension —
   *  not an absolute pixel count — so the button is the same relative size
   *  on any device instead of favoring a bigger or smaller one. */
  buttonRadiusFrac: number
  triggerRadius: number
  reactionDelayTicks: number
  cooldownTicks: number
  /** Dodge distance, as a fraction of the smaller bounds dimension — not an
   *  absolute pixel count — so movement covers the same relative amount of
   *  screen on any device instead of favoring a bigger or smaller one. */
  dodgeMinDistFrac: number
  dodgeMaxDistFrac: number
  coneHalfAngleRad: number
  /** How strongly a dodge is pulled toward the field center on top of
   *  fleeing the cursor: 0 = pure flee, 1 = ignores the cursor and always
   *  heads for center. Keeps the button from congregating near the edges. */
  centerPullWeight: number
  /** Multiplied into the button's radius after every successful hit, so it
   *  gets progressively smaller (and harder to click) as the score climbs. */
  radiusShrinkPerHit: number
  /** Radius never shrinks below this, so the button stays clickable. */
  minButtonRadius: number
  /** Multiplied into dodgeMinDistFrac/dodgeMaxDistFrac after every
   *  successful hit, so dodges cover more ground as the score climbs. */
  dodgeDistGrowthPerHit: number
  /** Distance growth never multiplies past this, so dodges stay bounded. */
  maxDodgeDistMultiplier: number
}

export const TICK_MS = 50

export const DEFAULT_CONFIG: EngineConfig = {
  tickMs: TICK_MS,
  buttonRadiusFrac: 0.1,
  triggerRadius: 90,
  reactionDelayTicks: 2, // ~100ms
  cooldownTicks: 4, // ~200ms
  dodgeMinDistFrac: 0.4,
  dodgeMaxDistFrac: 0.6,
  coneHalfAngleRad: Math.PI / 4, // ±45°
  centerPullWeight: 0.45,
  radiusShrinkPerHit: 0.97,
  minButtonRadius: 16,
  dodgeDistGrowthPerHit: 1.02,
  maxDodgeDistMultiplier: 2,
}

/** mulberry32 — small, fast, deterministic PRNG seeded by a single integer. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The play field wraps like a torus (Asteroids-style) instead of walling the
// button in, so it can dodge through an edge and reappear on the opposite
// side — see DodgeButton.vue for the matching peek-through render.
function wrapToBounds(p: Vec2, bounds: Bounds): Vec2 {
  return {
    x: ((p.x % bounds.width) + bounds.width) % bounds.width,
    y: ((p.y % bounds.height) + bounds.height) % bounds.height,
  }
}

/** Shortest signed distance from 0 to `value` on a dimension that wraps at `size`. */
export function wrappedDelta(value: number, size: number): number {
  let d = value % size
  if (d > size / 2) {
    d -= size
  } else if (d < -size / 2) {
    d += size
  }
  return d
}

function wrappedVec(a: Vec2, b: Vec2, bounds: Bounds): Vec2 {
  return {
    x: wrappedDelta(a.x - b.x, bounds.width),
    y: wrappedDelta(a.y - b.y, bounds.height),
  }
}

/**
 * The (x, y) offset of a dodge, before it's wrapped into the field. Distance
 * is intentionally uncapped: the caller applies this same offset to both the
 * wrapped canonical center (mod bounds, for hit-testing/distance math) and
 * an unwrapped running total (for the client's on-screen continuity) — see
 * the `rawCenter` tracking below — so there's no upper bound past which a
 * big jump becomes ambiguous.
 */
function dodgeOffset(
  center: Vec2,
  awayFrom: Vec2,
  rng: () => number,
  bounds: Bounds,
  config: EngineConfig,
  distMultiplier: number,
): Vec2 {
  const { x: dx, y: dy } = wrappedVec(center, awayFrom, bounds)
  const mag = Math.hypot(dx, dy)
  const fleeAngle = mag < 1e-6 ? rng() * Math.PI * 2 : Math.atan2(dy, dx)

  // Blend the flee direction with a small pull toward the field center
  // (both as unit vectors, so the blend stays direction-only) — otherwise
  // repeatedly fleeing the cursor tends to walk the button into a corner
  // and leave it hugging the edges. `center` is already canonical (in
  // [0, bounds)), so the direct vector to the middle is already the
  // shortest one — no wrap-aware math needed here.
  const toCenter = { x: bounds.width / 2 - center.x, y: bounds.height / 2 - center.y }
  const toCenterMag = Math.hypot(toCenter.x, toCenter.y)
  const flee = { x: Math.cos(fleeAngle), y: Math.sin(fleeAngle) }
  const pull =
    toCenterMag < 1e-6 ? flee : { x: toCenter.x / toCenterMag, y: toCenter.y / toCenterMag }
  const blended = {
    x: flee.x * (1 - config.centerPullWeight) + pull.x * config.centerPullWeight,
    y: flee.y * (1 - config.centerPullWeight) + pull.y * config.centerPullWeight,
  }
  const blendedMag = Math.hypot(blended.x, blended.y)
  const baseAngle = blendedMag < 1e-6 ? fleeAngle : Math.atan2(blended.y, blended.x)

  const angle = baseAngle + (rng() * 2 - 1) * config.coneHalfAngleRad
  const distFrac =
    config.dodgeMinDistFrac + rng() * (config.dodgeMaxDistFrac - config.dodgeMinDistFrac)
  const dist = distFrac * Math.min(bounds.width, bounds.height) * distMultiplier
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }
}

export interface EvasionEngine {
  /** Advance one tick given the cursor position sampled for this tick. Returns the new button center. */
  step(cursor: Vec2): Vec2
  /** Test a click/pointerdown against the button's current position. Returns true on a hit. */
  testHit(x: number, y: number): boolean
  getCenter(): Vec2
  /**
   * Same position as getCenter(), but never wrapped into [0, bounds) — it
   * just keeps accumulating every dodge offset. useDodgingButton.ts follows
   * this directly for the on-screen position instead of reconstructing
   * continuity from the wrapped value, so the display always slides the
   * true distance/direction of every dodge, however large.
   */
  getRawCenter(): Vec2
  getTick(): number
  /** Current button radius: shrinks by radiusShrinkPerHit on every
   *  successful hit, floored at minButtonRadius. Drives both hit-testing
   *  and the rendered size, so the two never drift out of sync. */
  getRadius(): number
}

export function createEvasionEngine(opts: {
  seed: number
  bounds: Bounds
  config?: Partial<EngineConfig>
  initialCenter?: Vec2
}): EvasionEngine {
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config }
  const rng = createRng(opts.seed)
  // Drawn from the same seeded rng as everything else, so the client
  // (predicting live) and the server (replaying the submitted round) agree
  // on where the round actually started without needing to transmit it.
  let center: Vec2 = opts.initialCenter ?? {
    x: rng() * opts.bounds.width,
    y: rng() * opts.bounds.height,
  }
  let rawCenter: Vec2 = center
  let pendingReadyAtTick: number | null = null
  let lastDodgeTick = -Infinity
  let tick = 0
  let hitCount = 0

  function currentDistMultiplier(): number {
    return Math.min(config.maxDodgeDistMultiplier, Math.pow(config.dodgeDistGrowthPerHit, hitCount))
  }

  function applyDodge(awayFrom: Vec2) {
    const offset = dodgeOffset(center, awayFrom, rng, opts.bounds, config, currentDistMultiplier())
    center = wrapToBounds({ x: center.x + offset.x, y: center.y + offset.y }, opts.bounds)
    rawCenter = { x: rawCenter.x + offset.x, y: rawCenter.y + offset.y }
  }

  function currentRadius(): number {
    const baseRadius = config.buttonRadiusFrac * Math.min(opts.bounds.width, opts.bounds.height)
    return Math.max(
      config.minButtonRadius,
      baseRadius * Math.pow(config.radiusShrinkPerHit, hitCount),
    )
  }

  return {
    step(cursor: Vec2): Vec2 {
      const { x: dx, y: dy } = wrappedVec(cursor, center, opts.bounds)
      const dist = Math.hypot(dx, dy)
      if (
        dist < config.triggerRadius &&
        pendingReadyAtTick === null &&
        tick - lastDodgeTick >= config.cooldownTicks
      ) {
        pendingReadyAtTick = tick + config.reactionDelayTicks
      }
      if (pendingReadyAtTick !== null && tick >= pendingReadyAtTick) {
        applyDodge(cursor)
        lastDodgeTick = tick
        pendingReadyAtTick = null
      }
      tick++
      return center
    },
    testHit(x: number, y: number): boolean {
      const { x: dx, y: dy } = wrappedVec({ x, y }, center, opts.bounds)
      const dist = Math.hypot(dx, dy)
      if (dist > currentRadius()) {
        return false
      }
      hitCount++
      applyDodge({ x, y })
      lastDodgeTick = tick
      pendingReadyAtTick = null
      return true
    },
    getCenter: () => center,
    getRawCenter: () => rawCenter,
    getTick: () => tick,
    getRadius: currentRadius,
  }
}

export interface SimulateRoundResult {
  clicks: number
  hitResults: boolean[]
  finalCenter: Vec2
}

/**
 * Replays a full recorded round in one shot: feeds `samples` through the engine
 * tick by tick, resolving each `hits` entry against the button position as it
 * stood immediately before that tick's own dodge decision is made.
 */
export function simulateRound(params: {
  samples: Vec2[]
  hits: HitEvent[]
  bounds: Bounds
  seed: number
  config?: Partial<EngineConfig>
  initialCenter?: Vec2
}): SimulateRoundResult {
  const engine = createEvasionEngine({
    seed: params.seed,
    bounds: params.bounds,
    config: params.config,
    initialCenter: params.initialCenter,
  })

  const order = params.hits.map((h, i) => ({ h, i })).sort((a, b) => a.h.tick - b.h.tick)
  const hitResults: boolean[] = new Array(params.hits.length).fill(false)

  let hi = 0
  for (let t = 0; t < params.samples.length; t++) {
    while (hi < order.length && order[hi]!.h.tick === t) {
      const { h, i } = order[hi]!
      hitResults[i] = engine.testHit(h.x, h.y)
      hi++
    }
    engine.step(params.samples[t]!)
  }

  return {
    clicks: hitResults.filter(Boolean).length,
    hitResults,
    finalCenter: engine.getCenter(),
  }
}
