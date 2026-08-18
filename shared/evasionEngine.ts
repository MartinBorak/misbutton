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
  dodgeMinDist: 120,
  dodgeMaxDist: 220,
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

function dodgeTarget(
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
  return wrapToBounds(
    { x: center.x + Math.cos(angle) * dist, y: center.y + Math.sin(angle) * dist },
    bounds,
  )
}

export interface EvasionEngine {
  /** Advance one tick given the cursor position sampled for this tick. Returns the new button center. */
  step(cursor: Vec2): Vec2
  /** Test a click/pointerdown against the button's current position. Returns true on a hit. */
  testHit(x: number, y: number): boolean
  getCenter(): Vec2
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
  let pendingReadyAtTick: number | null = null
  let lastDodgeTick = -Infinity
  let tick = 0

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
        center = dodgeTarget(center, cursor, rng, opts.bounds, config)
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
      center = dodgeTarget(center, { x, y }, rng, opts.bounds, config)
      lastDodgeTick = tick
      pendingReadyAtTick = null
      return true
    },
    getCenter: () => center,
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
