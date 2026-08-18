import {
  createEvasionEngine,
  TICK_MS,
  type Bounds,
  type EngineDebugInfo,
  type EvasionEngine,
  type Vec2,
} from '#shared/evasionEngine'

export interface DodgeLog {
  samples: [number, number][]
  hits: { tick: number; x: number; y: number }[]
}

/** Same curve as the old CSS `cubic-bezier(0.16, 1, 0.3, 1)` transition,
 *  evaluated in JS (Newton-Raphson, falling back to bisection) so the glide
 *  keeps its fast-start/slow-tail feel now that it's driven by ticks instead
 *  of a native CSS transition — see startPositionAnim below for why. */
function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  function sampleX(t: number): number {
    return 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3
  }
  function sampleY(t: number): number {
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3
  }
  function sampleXDerivative(t: number): number {
    return 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t ** 2 * (1 - x2)
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

function quadBezierPoint(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  const mt = 1 - t
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  }
}

const glideEase = cubicBezierEase(0.16, 1, 0.3, 1)
const GLIDE_TICKS = Math.round(1500 / TICK_MS) // matches the previous 1.5s CSS transition duration
const CURVE_FACTOR = 0.15 // max sideways bulge, as a fraction of the straight-line distance

// Drives shared/evasionEngine.ts on a fixed real-time tick and owns everything
// needed to both render the button and reconstruct the round for server replay.
export function useDodgingButton() {
  const x = ref(0)
  const y = ref(0)
  const isHit = ref(false)
  const clicks = ref(0)
  const bounds = ref<Bounds>({ width: 0, height: 0 })
  const radius = ref(0)
  const debugInfo = ref<EngineDebugInfo | null>(null)

  let engine: EvasionEngine | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null
  let hitTimeout: ReturnType<typeof setTimeout> | null = null
  let cursor: Vec2 = { x: 0, y: 0 }
  let samples: [number, number][] = []
  let hits: DodgeLog['hits'] = []

  // engine.getRawCenter() is never wrapped into [0, bounds) — it just keeps
  // accumulating every dodge, so animating toward it directly always slides
  // the true distance/direction of a dodge instead of guessing a wrapped
  // position's shortest path back to the last displayed spot; see
  // DodgeButton.vue for how that's rendered without ever going invisible.
  // The animation itself curves through a randomly-offset control point
  // instead of tracing a straight line — see startPositionAnim.
  let animTarget: Vec2 = { x: 0, y: 0 }
  let animStart: Vec2 = { x: 0, y: 0 }
  let animControl: Vec2 = { x: 0, y: 0 }
  let animElapsedTicks = GLIDE_TICKS

  function onPointerMove(e: PointerEvent) {
    cursor = { x: e.clientX, y: e.clientY }
  }

  function startPositionAnim(target: Vec2) {
    const start = { x: x.value, y: y.value }
    const dx = target.x - start.x
    const dy = target.y - start.y
    const dist = Math.hypot(dx, dy)
    // Perpendicular to the straight line, so the curve bulges to one side
    // instead of overshooting past the target.
    const perp = dist < 1e-6 ? { x: 0, y: 0 } : { x: -dy / dist, y: dx / dist }
    const bulge = (Math.random() * 2 - 1) * dist * CURVE_FACTOR
    animStart = start
    animTarget = target
    animControl = {
      x: (start.x + target.x) / 2 + perp.x * bulge,
      y: (start.y + target.y) / 2 + perp.y * bulge,
    }
    animElapsedTicks = 0
  }

  function advancePositionAnim() {
    if (animElapsedTicks >= GLIDE_TICKS) {
      x.value = animTarget.x
      y.value = animTarget.y
      return
    }
    animElapsedTicks++
    const t = glideEase(animElapsedTicks / GLIDE_TICKS)
    const point = quadBezierPoint(animStart, animControl, animTarget, t)
    x.value = point.x
    y.value = point.y
  }

  // Also pulls the current (possibly shrunk) radius, so the rendered size
  // always matches what the engine is actually hit-testing against.
  function syncFromEngine() {
    if (!engine) {
      return
    }
    const raw = engine.getRawCenter()
    if (raw.x !== animTarget.x || raw.y !== animTarget.y) {
      startPositionAnim(raw)
    }
    advancePositionAnim()
    radius.value = engine.getRadius()
    if (import.meta.dev) {
      debugInfo.value = engine.getDebugInfo()
    }
  }

  function tick() {
    if (!engine) {
      return
    }
    samples.push([cursor.x, cursor.y])
    engine.step(cursor)
    syncFromEngine()
  }

  function triggerHitEffect() {
    isHit.value = false
    requestAnimationFrame(() => {
      isHit.value = true
    })
    if (hitTimeout) {
      clearTimeout(hitTimeout)
    }
    hitTimeout = setTimeout(() => {
      isHit.value = false
    }, 1500) // matches the hit-ring CSS animation duration in main.css
  }

  function handlePointerDown(e: PointerEvent): boolean {
    if (!engine) {
      return false
    }
    const tickIndex = engine.getTick()
    const hitX = e.clientX
    const hitY = e.clientY
    const hit = engine.testHit(hitX, hitY)
    if (!hit) {
      return false
    }

    hits.push({ tick: tickIndex, x: hitX, y: hitY })
    clicks.value++
    syncFromEngine()
    triggerHitEffect()
    return true
  }

  function start(seed: number, roundBounds: Bounds) {
    samples = []
    hits = []
    clicks.value = 0
    bounds.value = roundBounds
    cursor = { x: roundBounds.width / 2, y: roundBounds.height / 2 }
    engine = createEvasionEngine({ seed, bounds: roundBounds })
    const center = engine.getRawCenter()
    x.value = center.x
    y.value = center.y
    animTarget = center
    animElapsedTicks = GLIDE_TICKS
    radius.value = engine.getRadius()
    if (import.meta.dev) {
      debugInfo.value = engine.getDebugInfo()
    }
    window.addEventListener('pointermove', onPointerMove)
    intervalId = setInterval(tick, TICK_MS)
  }

  function stop(): DodgeLog {
    if (intervalId) {
      clearInterval(intervalId)
    }
    intervalId = null
    window.removeEventListener('pointermove', onPointerMove)
    engine = null
    debugInfo.value = null
    return { samples, hits }
  }

  onUnmounted(() => {
    if (intervalId) {
      clearInterval(intervalId)
    }
    if (hitTimeout) {
      clearTimeout(hitTimeout)
    }
    window.removeEventListener('pointermove', onPointerMove)
  })

  return { x, y, isHit, clicks, bounds, radius, debugInfo, start, stop, handlePointerDown }
}
