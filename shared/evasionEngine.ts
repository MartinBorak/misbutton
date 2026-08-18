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
  /** How close the cursor needs to get before the button notices and
   *  dodges, as a fraction of the smaller bounds dimension. */
  triggerRadiusFrac: number
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
  /** Radius never shrinks below this fraction of the smaller bounds
   *  dimension, so the button stays clickable. */
  minButtonRadiusFrac: number
  /** Multiplied into dodgeMinDistFrac/dodgeMaxDistFrac after every
   *  successful hit, so dodges cover more ground as the score climbs. */
  dodgeDistGrowthPerHit: number
  /** Distance growth never multiplies past this, so dodges stay bounded. */
  maxDodgeDistMultiplier: number
  /** How many ticks a dodge takes to glide from its start to its target.
   *  The glide is part of the deterministic simulation (not just a client
   *  visual effect) so the position hit-testing and evasion actually use is
   *  always the same one rendered on screen — see advanceGlide/startGlide. */
  glideTicks: number
  /** Max sideways bulge of the dodge's curved path, as a fraction of the
   *  straight-line distance between its start and target. */
  curveFactor: number
}

export const TICK_MS = 50

/**
 * A few pixels of slack on top of the exact hit radius, purely to absorb
 * sub-pixel rendering/measurement noise (e.g. device pixel ratio rounding)
 * — NOT cross-engine math drift, which portableSin/Cos/Atan2 below
 * eliminate at the source instead.
 */
export const HIT_TOLERANCE_PX = 4

/**
 * The client (browser V8) and server (Node V8) each independently replay
 * this engine's dodge/glide math, and the anti-cheat model depends on both
 * landing on the exact same result. ECMA-262 only guarantees +, -, *, / and
 * Math.sqrt to be bit-identical across engines — Math.sin/cos/atan2/pow are
 * explicitly *not* required to match. That alone sounds academic, but the
 * dodge mechanic is a feedback loop (every dodge's angle is computed from
 * the position the previous dodge landed on), which turns a single
 * last-bit difference into exponential growth: verified directly against a
 * real Chrome build vs. Node, identical inputs stay bit-identical for
 * about 150-200 dodges, then the error roughly 10x's every ~20 dodges and
 * detonates into total chaos within another 50-100 — comfortably within a
 * single round once proximity-triggered dodges are counted alongside hits.
 * These reimplementations use only the portable primitives, so client and
 * server always agree exactly, no matter how long the round runs.
 */
function portableSinSmall(r: number): number {
  // Valid for |r| <= pi/4 (see reduceToOctant) — Taylor series converges to
  // within ~1e-10 there, far tighter than gameplay needs.
  const u = r * r
  const p =
    1 + u * (-1 / 6 + u * (1 / 120 + u * (-1 / 5040 + u * (1 / 362880 + u * (-1 / 39916800)))))
  return r * p
}

function portableCosSmall(r: number): number {
  const u = r * r
  return 1 + u * (-1 / 2 + u * (1 / 24 + u * (-1 / 720 + u * (1 / 40320 + u * (-1 / 3628800)))))
}

/** Reduces any angle to an octant offset r in [-pi/4, pi/4] plus which of
 *  the 4 quadrant-pairs it fell in, using only +, -, *, / and Math.round
 *  (exact/portable — unlike the trig functions this replaces). */
function reduceToOctant(x: number): { r: number; quadrant: number } {
  const twoPi = 2 * Math.PI
  const x1 = x - twoPi * Math.round(x / twoPi) // now in roughly [-pi, pi]
  const halfPi = Math.PI / 2
  const k = Math.round(x1 / halfPi)
  const r = x1 - k * halfPi // now in [-pi/4, pi/4]
  const quadrant = ((k % 4) + 4) % 4
  return { r, quadrant }
}

function portableSin(x: number): number {
  const { r, quadrant } = reduceToOctant(x)
  const s = portableSinSmall(r)
  const c = portableCosSmall(r)
  switch (quadrant) {
    case 0:
      return s
    case 1:
      return c
    case 2:
      return -s
    default:
      return -c
  }
}

function portableCos(x: number): number {
  const { r, quadrant } = reduceToOctant(x)
  const s = portableSinSmall(r)
  const c = portableCosSmall(r)
  switch (quadrant) {
    case 0:
      return c
    case 1:
      return -s
    case 2:
      return -c
    default:
      return s
  }
}

function portableAtanSmall(x: number): number {
  // Valid for |x| <= 0.01 (see portableAtan) — Taylor series converges to
  // within ~1e-15 there.
  const x2 = x * x
  return (
    x * (1 - x2 * (1 / 3 - x2 * (1 / 5 - x2 * (1 / 7 - x2 * (1 / 9 - x2 * (1 / 11 - x2 / 13))))))
  )
}

function portableAtan(x: number): number {
  // Repeatedly halve the *angle* via the tangent half-angle identity
  // (tan(θ/2) = tan(θ) / (1 + sec(θ))) until it's small enough for the
  // Taylor series to converge fast, then undo the halving on the result.
  // Uses only +, -, *, / and Math.sqrt.
  const negative = x < 0
  let ax = negative ? -x : x
  let halvings = 0
  while (ax > 0.01 && halvings < 60) {
    ax = ax / (1 + Math.sqrt(1 + ax * ax))
    halvings++
  }
  const result = portableAtanSmall(ax) * intPow(2, halvings)
  return negative ? -result : result
}

function portableAtan2(y: number, x: number): number {
  if (x > 0) {
    return portableAtan(y / x)
  }
  if (x < 0) {
    return y >= 0 ? portableAtan(y / x) + Math.PI : portableAtan(y / x) - Math.PI
  }
  if (y > 0) {
    return Math.PI / 2
  }
  if (y < 0) {
    return -Math.PI / 2
  }
  return 0
}

/** Math.pow for a non-negative integer exponent, via exponentiation by
 *  squaring — exact/portable since it only ever multiplies (unlike
 *  Math.pow itself, which ECMA-262 doesn't require to be bit-identical
 *  across engines). */
function intPow(base: number, exponent: number): number {
  let result = 1
  let b = base
  let e = exponent
  while (e > 0) {
    if (e & 1) {
      result *= b
    }
    b *= b
    e >>= 1
  }
  return result
}

export const DEFAULT_CONFIG: EngineConfig = {
  tickMs: TICK_MS,
  buttonRadiusFrac: 0.08,
  triggerRadiusFrac: 0.1,
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

/** Same curve as the old CSS `cubic-bezier(0.16, 1, 0.3, 1)` transition,
 *  evaluated in JS (Newton-Raphson, falling back to bisection) so the glide
 *  keeps its fast-start/slow-tail feel while being driven tick-by-tick
 *  instead of by a native CSS transition. */
function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  function sampleX(t: number): number {
    return 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  }
  function sampleY(t: number): number {
    return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t
  }
  function sampleXDerivative(t: number): number {
    return 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2)
  }

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
    t = x
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

function quadBezierPoint(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  const mt = 1 - t
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
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
  const mag = Math.sqrt(dx * dx + dy * dy)
  const fleeAngle = mag < 1e-6 ? rng() * Math.PI * 2 : portableAtan2(dy, dx)

  // Blend the flee direction with a small pull toward the field center
  // (both as unit vectors, so the blend stays direction-only) — otherwise
  // repeatedly fleeing the cursor tends to walk the button into a corner
  // and leave it hugging the edges. `center` is already canonical (in
  // [0, bounds)), so the direct vector to the middle is already the
  // shortest one — no wrap-aware math needed here.
  const toCenter = { x: bounds.width / 2 - center.x, y: bounds.height / 2 - center.y }
  const toCenterMag = Math.sqrt(toCenter.x * toCenter.x + toCenter.y * toCenter.y)
  const flee = { x: portableCos(fleeAngle), y: portableSin(fleeAngle) }
  const pull =
    toCenterMag < 1e-6 ? flee : { x: toCenter.x / toCenterMag, y: toCenter.y / toCenterMag }
  const blended = {
    x: flee.x * (1 - config.centerPullWeight) + pull.x * config.centerPullWeight,
    y: flee.y * (1 - config.centerPullWeight) + pull.y * config.centerPullWeight,
  }
  const blendedMag = Math.sqrt(blended.x * blended.x + blended.y * blended.y)
  const baseAngle = blendedMag < 1e-6 ? fleeAngle : portableAtan2(blended.y, blended.x)

  const angle = baseAngle + (rng() * 2 - 1) * config.coneHalfAngleRad
  const distFrac =
    config.dodgeMinDistFrac + rng() * (config.dodgeMaxDistFrac - config.dodgeMinDistFrac)
  const dist = distFrac * Math.min(bounds.width, bounds.height) * distMultiplier
  return { x: portableCos(angle) * dist, y: portableSin(angle) * dist }
}

/** Snapshot of the values that drift over a round as the progressive
 *  mechanics kick in — for the dev-only HUD readout, nothing gameplay
 *  depends on this. All distances are absolute pixels for this engine's
 *  actual bounds, already resolved from the *Frac config fractions. */
export interface EngineDebugInfo {
  tick: number
  hitCount: number
  radius: number
  triggerRadius: number
  dodgeDistMin: number
  dodgeDistMax: number
  dodgeDistMultiplier: number
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
   *  successful hit, floored at minButtonRadiusFrac. Drives both hit-testing
   *  and the rendered size, so the two never drift out of sync. */
  getRadius(): number
  getDebugInfo(): EngineDebugInfo
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

  // The dodge itself is part of the deterministic simulation, not a
  // client-side visual layered on top: `center`/`rawCenter` glide along a
  // curved path over `glideTicks` ticks instead of jumping straight to the
  // target, and hit-testing/evasion both read the position as it glides.
  // Otherwise the position everything reacts to jumps ahead of what's ever
  // rendered, and both clicking and re-dodging effectively require waiting
  // for the (purely cosmetic) animation to finish catching up.
  let glideStart: Vec2 = rawCenter
  let glideControl: Vec2 = rawCenter
  let glideTarget: Vec2 = rawCenter
  let glideElapsedTicks = config.glideTicks

  function currentDistMultiplier(): number {
    return Math.min(config.maxDodgeDistMultiplier, intPow(config.dodgeDistGrowthPerHit, hitCount))
  }

  // Starts a new glide from wherever the button currently is (which may
  // itself be mid-glide) toward a freshly-computed dodge target — so a
  // dodge decided before the previous one finished simply redirects from
  // its current position instead of waiting.
  function startGlide(awayFrom: Vec2) {
    const offset = dodgeOffset(center, awayFrom, rng, opts.bounds, config, currentDistMultiplier())
    const dist = Math.sqrt(offset.x * offset.x + offset.y * offset.y)
    // Perpendicular to the straight line, so the curve bulges to one side
    // instead of overshooting past the target. Drawn from the same seeded
    // rng as the rest of the dodge — this bulge is part of the actual
    // simulated path now, not just cosmetic, so it has to be deterministic.
    const perp = dist < 1e-6 ? { x: 0, y: 0 } : { x: -offset.y / dist, y: offset.x / dist }
    const bulge = (rng() * 2 - 1) * dist * config.curveFactor
    glideStart = rawCenter
    glideTarget = { x: rawCenter.x + offset.x, y: rawCenter.y + offset.y }
    glideControl = {
      x: (glideStart.x + glideTarget.x) / 2 + perp.x * bulge,
      y: (glideStart.y + glideTarget.y) / 2 + perp.y * bulge,
    }
    glideElapsedTicks = 0
  }

  // Advances the current glide by one tick (a no-op once it's settled at
  // its target) and syncs center/rawCenter to the result.
  function advanceGlide() {
    if (glideElapsedTicks >= config.glideTicks) {
      return
    }
    glideElapsedTicks++
    const t = glideEase(glideElapsedTicks / config.glideTicks)
    rawCenter = quadBezierPoint(glideStart, glideControl, glideTarget, t)
    center = wrapToBounds(rawCenter, opts.bounds)
  }

  function dodge(awayFrom: Vec2) {
    startGlide(awayFrom)
    advanceGlide() // same-tick first step, so a dodge is visible immediately
  }

  const minDim = Math.min(opts.bounds.width, opts.bounds.height)

  function currentRadius(): number {
    const baseRadius = config.buttonRadiusFrac * minDim
    return Math.max(
      config.minButtonRadiusFrac * minDim,
      baseRadius * intPow(config.radiusShrinkPerHit, hitCount),
    )
  }

  return {
    step(cursor: Vec2): Vec2 {
      advanceGlide()
      const { x: dx, y: dy } = wrappedVec(cursor, center, opts.bounds)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (
        dist < config.triggerRadiusFrac * minDim &&
        pendingReadyAtTick === null &&
        tick - lastDodgeTick >= config.cooldownTicks
      ) {
        pendingReadyAtTick = tick + config.reactionDelayTicks
      }
      if (pendingReadyAtTick !== null && tick >= pendingReadyAtTick) {
        dodge(cursor)
        lastDodgeTick = tick
        pendingReadyAtTick = null
      }
      tick++
      return center
    },
    testHit(x: number, y: number): boolean {
      const { x: dx, y: dy } = wrappedVec({ x, y }, center, opts.bounds)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > currentRadius() + HIT_TOLERANCE_PX) {
        return false
      }
      hitCount++
      dodge({ x, y })
      lastDodgeTick = tick
      pendingReadyAtTick = null
      return true
    },
    getCenter: () => center,
    getRawCenter: () => rawCenter,
    getTick: () => tick,
    getRadius: currentRadius,
    getDebugInfo: () => {
      const distMultiplier = currentDistMultiplier()
      return {
        tick,
        hitCount,
        radius: currentRadius(),
        triggerRadius: config.triggerRadiusFrac * minDim,
        dodgeDistMin: config.dodgeMinDistFrac * minDim * distMultiplier,
        dodgeDistMax: config.dodgeMaxDistFrac * minDim * distMultiplier,
        dodgeDistMultiplier: distMultiplier,
      }
    },
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
