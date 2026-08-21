/**
 * Pure, DOM-free deterministic simulation of the dodging button.
 * Used identically by the client (real-time rendering) and the server
 * (replay verification of a submitted round) — see server/api/round/submit.post.ts.
 */

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
  /**
   * Base button radius, as a fraction of the smaller bounds dimension —
   *  not an absolute pixel count — so the button is the same relative size
   * on any device instead of favoring a bigger or smaller one.
   */
  buttonRadiusFrac: number
  /**
   * How close the cursor needs to get before the button notices and
   * dodges, as a fraction of the smaller bounds dimension.
   */
  triggerRadiusFrac: number
  /**
   * Ticks between the cursor entering the trigger radius and the button
   * actually dodging — its simulated "reaction time".
   */
  reactionDelayTicks: number
  /**
   * Minimum ticks after a dodge before proximity can arm another one, so
   * a lingering cursor can't trigger dodges back-to-back.
   */
  cooldownTicks: number
  /**
   * Minimum dodge distance, as a fraction of the smaller bounds dimension
   *  — not an absolute pixel count — so movement covers the same relative
   *  amount of screen on any device instead of favoring a bigger or
   * smaller one.
   */
  dodgeMinDistFrac: number
  /** Maximum dodge distance, same units as dodgeMinDistFrac. */
  dodgeMaxDistFrac: number
  /**
   * Half-angle of the random cone applied around the ideal flee/center-pull
   * direction, so dodge angles aren't perfectly predictable.
   */
  coneHalfAngleRad: number
  /**
   * How strongly a dodge is pulled toward the field center on top of
   *  fleeing the cursor: 0 = pure flee, 1 = ignores the cursor and always
   * heads for center. Keeps the button from congregating near the edges.
   */
  centerPullWeight: number
  /**
   * Multiplied into the button's radius after every successful hit, so it
   * gets progressively smaller (and harder to click) as the score climbs.
   */
  radiusShrinkPerHit: number
  /**
   * Radius never shrinks below this fraction of the smaller bounds
   * dimension, so the button stays clickable.
   */
  minButtonRadiusFrac: number
  /**
   * Multiplied into dodgeMinDistFrac/dodgeMaxDistFrac after every
   * successful hit, so dodges cover more ground as the score climbs.
   */
  dodgeDistGrowthPerHit: number
  /** Distance growth never multiplies past this, so dodges stay bounded. */
  maxDodgeDistMultiplier: number
  /**
   * How many ticks a dodge takes to glide from its start to its target.
   *  The glide is part of the deterministic simulation (not just a client
   *  visual effect) so the position hit-testing and evasion actually use is
   * always the same one rendered on screen — see advanceGlide/startGlide.
   */
  glideTicks: number
  /**
   * Max sideways bulge of the dodge's curved path, as a fraction of the
   * straight-line distance between its start and target.
   */
  curveFactor: number
}

/** Simulation step length — 20 ticks/sec, frequent enough for smooth-looking movement while keeping a round's recorded sample array small. */
export const TICK_MS = 50

/**
 * A few pixels of slack on top of the exact hit radius, purely to absorb
 * sub-pixel rendering/measurement noise (e.g. device pixel ratio rounding)
 * — NOT cross-engine math drift, which portableSinCos below eliminates at
 * the source instead.
 */
export const HIT_TOLERANCE_PX = 4

/**
 * sin/cos below are reimplemented from Taylor series using only +, -, *
 * (Math.sin/cos aren't required to be bit-identical across JS engines, but
 * client and server must land on the exact same dodge math every tick).
 * evalPoly evaluates one such series via Horner's method from a coefficient
 * list, so each reimplementation is just its list. Everything else here
 * sticks to +, -, *, / and Math.sqrt, which IEEE-754 does pin down exactly.
 */
function evalPoly(u: number, coeffs: readonly number[]): number {
  return coeffs.reduce((p, c) => p * u + c, 0)
}

// sin(r) = r·(1 − r²/3! + r⁴/5! − r⁶/7! + r⁸/9! − r¹⁰/11!)
const SIN_SMALL_COEFFS = [-1 / 39916800, 1 / 362880, -1 / 5040, 1 / 120, -1 / 6, 1]
// cos(r) = 1 − r²/2! + r⁴/4! − r⁶/6! + r⁸/8! − r¹⁰/10!
const COS_SMALL_COEFFS = [-1 / 3628800, 1 / 40320, -1 / 720, 1 / 24, -1 / 2, 1]

/**
 * Both valid for |r| <= pi/4 (see reduceToOctant) — the Taylor series
 * converge to within ~1e-10 there, far tighter than gameplay needs.
 */
function portableSinSmall(r: number): number {
  return r * evalPoly(r * r, SIN_SMALL_COEFFS)
}

function portableCosSmall(r: number): number {
  return evalPoly(r * r, COS_SMALL_COEFFS)
}

/**
 * Reduces any angle to an octant offset r in [-pi/4, pi/4] plus which of
 * the 4 quadrant-pairs it fell in, using only +, -, *, / and Math.round
 * (exact/portable — unlike the trig functions this replaces).
 */
function reduceToOctant(x: number): { r: number; quadrant: number } {
  const twoPi = 2 * Math.PI
  const x1 = x - twoPi * Math.round(x / twoPi) // now in roughly [-pi, pi]
  const halfPi = Math.PI / 2
  const k = Math.round(x1 / halfPi)
  const r = x1 - k * halfPi // now in [-pi/4, pi/4]
  const quadrant = ((k % 4) + 4) % 4
  return { r, quadrant }
}

/**
 * Callers always need sin and cos of the same angle together (see
 * dodgeOffset), so this computes both from one octant reduction instead of
 * making callers pay for reduceToOctant/portableSinSmall/portableCosSmall
 * twice over to get the second value.
 */
function portableSinCos(x: number): { sin: number; cos: number } {
  const { r, quadrant } = reduceToOctant(x)
  const s = portableSinSmall(r)
  const c = portableCosSmall(r)
  switch (quadrant) {
    case 0:
      return { sin: s, cos: c }
    case 1:
      return { sin: c, cos: -s }
    case 2:
      return { sin: -s, cos: -c }
    default:
      return { sin: -c, cos: s }
  }
}

/** Rotates a vector by `angle` radians — the unit-vector equivalent of adding to an angle. */
function rotate(v: Vec2, angle: number): Vec2 {
  const { sin, cos } = portableSinCos(angle)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

/** A unit vector pointing in a uniformly random direction. Consumes exactly one rng draw. */
function randomUnitVec(rng: () => number): Vec2 {
  const { sin, cos } = portableSinCos(rng() * Math.PI * 2)
  return { x: cos, y: sin }
}

/**
 * Math.pow for a non-negative integer exponent, via exponentiation by
 * squaring — exact/portable since it only ever multiplies (unlike
 * Math.pow itself, which ECMA-262 doesn't require to be bit-identical
 * across engines).
 */
function intPow(base: number, exponent: number, result = 1): number {
  if (exponent <= 0) {
    return result
  }
  return intPow(base * base, exponent >> 1, exponent & 1 ? result * base : result)
}

export const DEFAULT_CONFIG: EngineConfig = {
  buttonRadiusFrac: 0.08,
  triggerRadiusFrac: 0.2,
  reactionDelayTicks: 2, // ~100ms
  cooldownTicks: 4, // ~200ms
  dodgeMinDistFrac: 0.4,
  dodgeMaxDistFrac: 0.6,
  coneHalfAngleRad: Math.PI / 4, // ±45°
  centerPullWeight: 0.45,
  radiusShrinkPerHit: 0.97,
  minButtonRadiusFrac: 0.02,
  dodgeDistGrowthPerHit: 1.02,
  maxDodgeDistMultiplier: 2,
  glideTicks: 30, // 1.5s at the default 50ms tick
  curveFactor: 0.15,
}

/**
 * The button's radius/proximity-trigger radius at the start of a round
 * (hitCount 0, before radiusShrinkPerHit has applied) — the same formulas
 * createEvasionEngine's currentRadius()/step() use internally, factored out
 * so callers that need to match a fresh round's sizing before an engine
 * instance exists (e.g. index.vue's idle button) don't hand-copy them.
 */
export function initialButtonRadius(bounds: Bounds, config: EngineConfig = DEFAULT_CONFIG): number {
  return config.buttonRadiusFrac * Math.min(bounds.width, bounds.height)
}

/** Same as initialButtonRadius, but for the proximity-trigger radius. */
export function initialTriggerRadius(
  bounds: Bounds,
  config: EngineConfig = DEFAULT_CONFIG,
): number {
  return config.triggerRadiusFrac * Math.min(bounds.width, bounds.height)
}

/**
 * Same curve as the old CSS `cubic-bezier(0.16, 1, 0.3, 1)` transition,
 * evaluated in JS (Newton-Raphson, falling back to bisection) so the glide
 * keeps its fast-start/slow-tail feel while being driven tick-by-tick
 * instead of by a native CSS transition. The control points imply P0=(0,0)
 * and P3=(1,1), so the cubic reduces to a plain polynomial in t — its
 * coefficients are precomputed once per curve so every sample/derivative
 * below is a 3-term Horner evaluation instead of re-expanding (1-t) terms.
 */
function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx

  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by

  /** The curve's x at parameter t. */
  function sampleX(t: number): number {
    return ((ax * t + bx) * t + cx) * t
  }
  /** The curve's y at parameter t. */
  function sampleY(t: number): number {
    return ((ay * t + by) * t + cy) * t
  }
  /** dx/dt at parameter t, used by solveXForT's Newton-Raphson step. */
  function sampleXDerivative(t: number): number {
    return (3 * ax * t + 2 * bx) * t + cx
  }

  /** Finds the parameter t whose x lands on the given progress x, in [0, 1]. */
  function solveXForT(x: number): number {
    let t = x
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x
      if (Math.abs(dx) < 1e-6) {
        return t
      }
      const derivative = sampleXDerivative(t)
      if (Math.abs(derivative) < 1e-6) {
        break
      }
      t -= dx / derivative
    }
    let lo = 0
    let hi = 1
    while (hi - lo > 1e-6) {
      t = (lo + hi) / 2
      if (sampleX(t) < x) {
        lo = t
      } else {
        hi = t
      }
    }
    return t
  }

  return (t: number) => {
    if (t <= 0) {
      return 0
    }
    if (t >= 1) {
      return 1
    }
    return sampleY(solveXForT(t))
  }
}

const glideEase = cubicBezierEase(0.16, 1, 0.3, 1)

/** Point at parameter t along the quadratic Bezier curve p0 -> p1 -> p2. */
function quadBezierPoint(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  const mtT2 = 2 * mt * t
  return {
    x: mt2 * p0.x + mtT2 * p1.x + t2 * p2.x,
    y: mt2 * p0.y + mtT2 * p1.y + t2 * p2.y,
  }
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

/**
 * The play field wraps like a torus (Asteroids-style) instead of walling the
 * button in, so it can dodge through an edge and reappear on the opposite
 * side — see DodgeButton.vue for the matching peek-through render.
 */
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

/** Shortest wrapped vector from b to a, per dimension (see wrappedDelta). */
function wrappedVec(a: Vec2, b: Vec2, bounds: Bounds): Vec2 {
  return {
    x: wrappedDelta(a.x - b.x, bounds.width),
    y: wrappedDelta(a.y - b.y, bounds.height),
  }
}

/** Length of a vector. */
function magnitude(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

/** Shortest distance from b to a across the wrapping field (see wrappedVec). */
function wrappedDist(a: Vec2, b: Vec2, bounds: Bounds): number {
  return magnitude(wrappedVec(a, b, bounds))
}

/**
 * Below this length a vector has no meaningful direction, so normalizing it
 * would blow up instead of pointing anywhere useful.
 */
const MIN_DIRECTION_MAGNITUDE = 1e-6

/**
 * Unit vector pointing the same way as v, or `fallback` when v is too short
 * to have a direction at all. The fallback is a function, not a value,
 * because one caller falls back to a random direction — computing that
 * eagerly would consume an rng draw on the overwhelmingly common path where
 * it isn't needed, desyncing the client's and server's rng streams.
 */
function normalize(v: Vec2, fallback: () => Vec2): Vec2 {
  const mag = magnitude(v)
  if (mag < MIN_DIRECTION_MAGNITUDE) {
    return fallback()
  }
  return { x: v.x / mag, y: v.y / mag }
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
  /**
   * Directions are carried as unit vectors rather than angles: the flee
   * direction is just the normalized away-vector, so there's no need to
   * convert to an angle and straight back again (cos(atan2(dy, dx)) is
   * dx/mag by definition). Only the random cone below actually needs trig.
   */
  const flee = normalize(wrappedVec(center, awayFrom, bounds), () => randomUnitVec(rng))

  /**
   * Blend the flee direction with a small pull toward the field center
   * (both as unit vectors, so the blend stays direction-only) — otherwise
   * repeatedly fleeing the cursor tends to walk the button into a corner
   * and leave it hugging the edges. `center` is already canonical (in
   * [0, bounds)), so the direct vector to the middle is already the
   * shortest one — no wrap-aware math needed here.
   */
  const toCenter = { x: bounds.width / 2 - center.x, y: bounds.height / 2 - center.y }
  const pull = normalize(toCenter, () => flee)
  const fleeWeight = 1 - config.centerPullWeight
  const blended = {
    x: flee.x * fleeWeight + pull.x * config.centerPullWeight,
    y: flee.y * fleeWeight + pull.y * config.centerPullWeight,
  }
  const base = normalize(blended, () => flee)

  const direction = rotate(base, (rng() * 2 - 1) * config.coneHalfAngleRad)
  const distFrac =
    config.dodgeMinDistFrac + rng() * (config.dodgeMaxDistFrac - config.dodgeMinDistFrac)
  const dist = distFrac * Math.min(bounds.width, bounds.height) * distMultiplier
  return { x: direction.x * dist, y: direction.y * dist }
}

export interface EvasionEngine {
  /** Advance one tick given the cursor position sampled for this tick. Returns the new button center. */
  step(cursor: Vec2): Vec2
  /** Test a click/pointerdown against the button's current position. Returns true on a hit. */
  testHit(x: number, y: number): boolean
  /** Current wrapped position (always inside [0, bounds)). */
  getCenter(): Vec2
  /**
   * Same position as getCenter(), but never wrapped into [0, bounds) — it
   * just keeps accumulating every dodge offset. useDodgingButton.ts follows
   * this directly for the on-screen position instead of reconstructing
   * continuity from the wrapped value, so the display always slides the
   * true distance/direction of every dodge, however large.
   */
  getRawCenter(): Vec2
  /** Number of ticks simulated so far. */
  getTick(): number
  /**
   * Current button radius: shrinks by radiusShrinkPerHit on every
   * successful hit, floored at minButtonRadiusFrac. Drives both hit-testing
   * and the rendered size, so the two never drift out of sync.
   */
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
  /**
   * Drawn from the same seeded rng as everything else, so the client
   * (predicting live) and the server (replaying the submitted round) agree
   * on where the round actually started without needing to transmit it.
   */
  let center: Vec2 = opts.initialCenter ?? {
    x: rng() * opts.bounds.width,
    y: rng() * opts.bounds.height,
  }
  let rawCenter: Vec2 = center
  let pendingReadyAtTick: number | null = null
  let lastDodgeTick = -Infinity
  let tick = 0
  let hitCount = 0

  /**
   * The dodge itself is part of the deterministic simulation, not a
   * client-side visual layered on top: `center`/`rawCenter` glide along a
   * curved path over `glideTicks` ticks instead of jumping straight to the
   * target, and hit-testing/evasion both read the position as it glides.
   * Otherwise the position everything reacts to jumps ahead of what's ever
   * rendered, and both clicking and re-dodging effectively require waiting
   * for the (purely cosmetic) animation to finish catching up.
   */
  let glideStart: Vec2 = rawCenter
  let glideControl: Vec2 = rawCenter
  let glideTarget: Vec2 = rawCenter
  let glideElapsedTicks = config.glideTicks

  /** How much bigger dodges have gotten from repeated hits, capped at maxDodgeDistMultiplier. */
  function currentDistMultiplier(): number {
    return Math.min(config.maxDodgeDistMultiplier, intPow(config.dodgeDistGrowthPerHit, hitCount))
  }

  /**
   * Starts a new glide from wherever the button currently is (which may
   * itself be mid-glide) toward a freshly-computed dodge target — so a
   * dodge decided before the previous one finished simply redirects from
   * its current position instead of waiting.
   */
  function startGlide(awayFrom: Vec2) {
    const offset = dodgeOffset(center, awayFrom, rng, opts.bounds, config, currentDistMultiplier())
    const dist = magnitude(offset)
    /**
     * Perpendicular to the straight line, so the curve bulges to one side
     * instead of overshooting past the target. Drawn from the same seeded
     * rng as the rest of the dodge — this bulge is part of the actual
     * simulated path now, not just cosmetic, so it has to be deterministic.
     */
    const perp =
      dist < MIN_DIRECTION_MAGNITUDE ? { x: 0, y: 0 } : { x: -offset.y / dist, y: offset.x / dist }
    const bulge = (rng() * 2 - 1) * dist * config.curveFactor
    glideStart = rawCenter
    glideTarget = { x: rawCenter.x + offset.x, y: rawCenter.y + offset.y }
    glideControl = {
      x: (glideStart.x + glideTarget.x) / 2 + perp.x * bulge,
      y: (glideStart.y + glideTarget.y) / 2 + perp.y * bulge,
    }
    glideElapsedTicks = 0
  }

  /**
   * Advances the current glide by one tick (a no-op once it's settled at
   * its target) and syncs center/rawCenter to the result.
   */
  function advanceGlide() {
    if (glideElapsedTicks >= config.glideTicks) {
      return
    }
    glideElapsedTicks++
    const t = glideEase(glideElapsedTicks / config.glideTicks)
    rawCenter = quadBezierPoint(glideStart, glideControl, glideTarget, t)
    center = wrapToBounds(rawCenter, opts.bounds)
  }

  /**
   * Triggers a dodge away from awayFrom, taking its first glide step
   * immediately, and restarts the cooldown/reaction timers — every dodge
   * has to do both, so they live together rather than at each call site.
   */
  function dodge(awayFrom: Vec2) {
    startGlide(awayFrom)
    advanceGlide() // same-tick first step, so a dodge is visible immediately
    lastDodgeTick = tick
    pendingReadyAtTick = null
  }

  const minDim = Math.min(opts.bounds.width, opts.bounds.height)
  const baseRadius = initialButtonRadius(opts.bounds, config)
  const minRadius = config.minButtonRadiusFrac * minDim
  const triggerRadius = initialTriggerRadius(opts.bounds, config)

  /** Current button radius, shrunk by past hits and floored at minButtonRadiusFrac. */
  function currentRadius(): number {
    return Math.max(minRadius, baseRadius * intPow(config.radiusShrinkPerHit, hitCount))
  }

  return {
    step(cursor: Vec2): Vec2 {
      advanceGlide()
      if (
        wrappedDist(cursor, center, opts.bounds) < triggerRadius &&
        pendingReadyAtTick === null &&
        tick - lastDodgeTick >= config.cooldownTicks
      ) {
        pendingReadyAtTick = tick + config.reactionDelayTicks
      }
      if (pendingReadyAtTick !== null && tick >= pendingReadyAtTick) {
        dodge(cursor)
      }
      tick++
      return center
    },
    testHit(x: number, y: number): boolean {
      if (wrappedDist({ x, y }, center, opts.bounds) > currentRadius() + HIT_TOLERANCE_PX) {
        return false
      }
      hitCount++
      dodge({ x, y })
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
