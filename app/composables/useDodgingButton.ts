import {
  createEvasionEngine,
  TICK_MS,
  wrappedDelta,
  type Bounds,
  type EvasionEngine,
  type Vec2,
} from '#shared/evasionEngine'

export interface DodgeLog {
  samples: [number, number][]
  hits: { tick: number; x: number; y: number }[]
}

// Drives shared/evasionEngine.ts on a fixed real-time tick and owns everything
// needed to both render the button and reconstruct the round for server replay.
export function useDodgingButton() {
  const x = ref(0)
  const y = ref(0)
  const isHit = ref(false)
  const clicks = ref(0)
  const bounds = ref<Bounds>({ width: 0, height: 0 })

  let engine: EvasionEngine | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null
  let hitTimeout: ReturnType<typeof setTimeout> | null = null
  let cursor: Vec2 = { x: 0, y: 0 }
  let samples: [number, number][] = []
  let hits: DodgeLog['hits'] = []

  function onPointerMove(e: PointerEvent) {
    cursor = { x: e.clientX, y: e.clientY }
  }

  // The engine's center is always wrapped into [0, bounds) — snapping the
  // rendered position straight to that would show a dodge through one edge
  // as a jump to some unrelated point instead of continuing off-screen.
  // Nudge the displayed x/y by the shortest wrapped delta from where it
  // last was, so it keeps sliding the same direction through the edge; see
  // DodgeButton.vue for how that's rendered without ever going invisible.
  function setDisplayPosition(center: Vec2) {
    x.value += wrappedDelta(center.x - x.value, bounds.value.width)
    y.value += wrappedDelta(center.y - y.value, bounds.value.height)
  }

  function tick() {
    if (!engine) {
      return
    }
    samples.push([cursor.x, cursor.y])
    setDisplayPosition(engine.step(cursor))
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
    }, 500)
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
    setDisplayPosition(engine.getCenter())
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
    const center = engine.getCenter()
    x.value = center.x
    y.value = center.y
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

  return { x, y, isHit, clicks, bounds, start, stop, handlePointerDown }
}
