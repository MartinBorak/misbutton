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
  buttonRadius: number
  triggerRadius: number
  reactionDelayTicks: number
  cooldownTicks: number
  dodgeMinDist: number
  dodgeMaxDist: number
  coneHalfAngleRad: number
}

export const TICK_MS = 50

export const DEFAULT_CONFIG: EngineConfig = {
  tickMs: TICK_MS,
  buttonRadius: 36,
  triggerRadius: 90,
  reactionDelayTicks: 2, // ~100ms
  cooldownTicks: 4, // ~200ms
  dodgeMinDist: 504,
  dodgeMaxDist: 966,
  coneHalfAngleRad: Math.PI / 4, // ±45°
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
): Vec2 {
  const { x: dx, y: dy } = wrappedVec(center, awayFrom, bounds)
  const mag = Math.hypot(dx, dy)
  const baseAngle = mag < 1e-6 ? rng() * Math.PI * 2 : Math.atan2(dy, dx)
  const angle = baseAngle + (rng() * 2 - 1) * config.coneHalfAngleRad
  const dist = config.dodgeMinDist + rng() * (config.dodgeMaxDist - config.dodgeMinDist)
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
}

export function createEvasionEngine(opts: {
  seed: number
  bounds: Bounds
  config?: Partial<EngineConfig>
  initialCenter?: Vec2
}): EvasionEngine {
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config }
  const rng = createRng(opts.seed)
  let center: Vec2 = opts.initialCenter ?? { x: opts.bounds.width / 2, y: opts.bounds.height / 2 }
  let rawCenter: Vec2 = center
  let pendingReadyAtTick: number | null = null
  let lastDodgeTick = -Infinity
  let tick = 0

  function applyDodge(awayFrom: Vec2) {
    const offset = dodgeOffset(center, awayFrom, rng, opts.bounds, config)
    center = wrapToBounds({ x: center.x + offset.x, y: center.y + offset.y }, opts.bounds)
    rawCenter = { x: rawCenter.x + offset.x, y: rawCenter.y + offset.y }
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
      if (dist > config.buttonRadius) {
        return false
      }
      applyDodge({ x, y })
      lastDodgeTick = tick
      pendingReadyAtTick = null
      return true
    },
    getCenter: () => center,
    getRawCenter: () => rawCenter,
    getTick: () => tick,
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
