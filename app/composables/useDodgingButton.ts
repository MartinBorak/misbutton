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

const RIPPLE_TICKS = Math.round(1500 / TICK_MS) // matches the hit-ring CSS animation duration in main.css

// Drives shared/evasionEngine.ts on a fixed real-time tick and owns everything
// needed to both render the button and reconstruct the round for server replay.
export function useDodgingButton() {
  const x = ref(0)
  const y = ref(0)
  // Ids of the hit-ring ripples currently animating — a list rather than a
  // single flag because a hit landing in the second half of the previous
  // ripple starts a new one that plays alongside it instead of cutting it
  // off; see triggerHitEffect.
  const ripples = ref<number[]>([])
  const clicks = ref(0)
  const bounds = ref<Bounds>({ width: 0, height: 0 })
  const radius = ref(0)
  const debugInfo = ref<EngineDebugInfo | null>(null)

  let engine: EvasionEngine | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null
  let rippleSeq = 0
  let lastRippleTick: number | null = null
  const rippleTimeouts = new Set<ReturnType<typeof setTimeout>>()
  let cursor: Vec2 = { x: 0, y: 0 }
  let samples: [number, number][] = []
  let hits: DodgeLog['hits'] = []

  function onPointerMove(e: PointerEvent) {
    cursor = { x: e.clientX, y: e.clientY }
  }

  // The dodge's curved glide is now simulated inside the shared engine
  // itself (see shared/evasionEngine.ts) rather than being a client-only
  // visual layered on top of an instantly-teleporting position — so what's
  // rendered here is always exactly the same position hit-testing and
  // evasion are reacting to, tick for tick.
  function syncFromEngine() {
    if (!engine) {
      return
    }
    const raw = engine.getRawCenter()
    x.value = raw.x
    y.value = raw.y
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

  // A hit landing while the most recent ripple is still in its first half
  // is dropped rather than restarting it — otherwise rapid hits kept
  // resetting the ring back to scale 1 and it never visibly grew. Past the
  // halfway point, a fresh ripple starts and plays on top of the old one
  // instead of cutting it off.
  function triggerHitEffect(tickIndex: number) {
    if (lastRippleTick !== null && tickIndex - lastRippleTick < RIPPLE_TICKS / 2) {
      return
    }
    lastRippleTick = tickIndex
    const id = rippleSeq++
    ripples.value = [...ripples.value, id]
    const timeoutId = setTimeout(() => {
      ripples.value = ripples.value.filter((r) => r !== id)
      rippleTimeouts.delete(timeoutId)
    }, RIPPLE_TICKS * TICK_MS)
    rippleTimeouts.add(timeoutId)
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
    triggerHitEffect(tickIndex)
    return true
  }

  function start(seed: number, roundBounds: Bounds) {
    samples = []
    hits = []
    clicks.value = 0
    bounds.value = roundBounds
    cursor = { x: roundBounds.width / 2, y: roundBounds.height / 2 }
    // Screen center, matching the idle button's resting position (index.vue)
    // so the round's first dodge is a continuous reaction rather than a
    // teleport — must stay identical to submit.post.ts's replay, which has
    // no other way to know where the round visually began.
    engine = createEvasionEngine({
      seed,
      bounds: roundBounds,
      initialCenter: { x: roundBounds.width / 2, y: roundBounds.height / 2 },
    })
    syncFromEngine()
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
    for (const timeoutId of rippleTimeouts) {
      clearTimeout(timeoutId)
    }
    rippleTimeouts.clear()
    ripples.value = []
    lastRippleTick = null
    return { samples, hits }
  }

  onUnmounted(() => {
    if (intervalId) {
      clearInterval(intervalId)
    }
    for (const timeoutId of rippleTimeouts) {
      clearTimeout(timeoutId)
    }
    window.removeEventListener('pointermove', onPointerMove)
  })

  return { x, y, ripples, clicks, bounds, radius, debugInfo, start, stop, handlePointerDown }
}
