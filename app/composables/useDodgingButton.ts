import {
  createEvasionEngine,
  TICK_MS,
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

  let engine: EvasionEngine | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null
  let hitTimeout: ReturnType<typeof setTimeout> | null = null
  let cursor: Vec2 = { x: 0, y: 0 }
  let samples: [number, number][] = []
  let hits: DodgeLog['hits'] = []

  function onPointerMove(e: PointerEvent) {
    cursor = { x: e.clientX, y: e.clientY }
  }

  function tick() {
    if (!engine) {
      return
    }
    samples.push([cursor.x, cursor.y])
    const center = engine.step(cursor)
    x.value = center.x
    y.value = center.y
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
    const center = engine.getCenter()
    x.value = center.x
    y.value = center.y
    triggerHitEffect()
    return true
  }

  function start(seed: number, bounds: Bounds) {
    samples = []
    hits = []
    clicks.value = 0
    cursor = { x: bounds.width / 2, y: bounds.height / 2 }
    engine = createEvasionEngine({ seed, bounds })
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

  return { x, y, isHit, clicks, start, stop, handlePointerDown }
}
