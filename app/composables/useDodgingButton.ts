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

/**
 * Drives both the ripple's lifetime here and the hit-ring animation's
 * duration in main.css (set as a CSS custom property, see DodgeButton.vue) —
 * one source of truth instead of two numbers that have to be kept in sync by hand.
 * 1500ms is purely an aesthetic choice, tuned so the ring has time to fully
 * expand and fade without lingering into the next click.
 */
export const RIPPLE_DURATION_MS = 1500
/** RIPPLE_DURATION_MS expressed in ticks, for comparison against tick-indexed state in triggerHitEffect. */
const RIPPLE_TICKS = Math.round(RIPPLE_DURATION_MS / TICK_MS)

/**
 * Drives shared/evasionEngine.ts on a fixed real-time tick and owns everything
 * needed to both render the button and reconstruct the round for server replay.
 */
export function useDodgingButton() {
  const x = ref(0)
  const y = ref(0)
  /**
   * Ids of the hit-ring ripples currently animating — a list rather than a
   * single flag because a hit landing in the second half of the previous
   * ripple starts a new one that plays alongside it instead of cutting it
   * off; see triggerHitEffect.
   */
  const ripples = ref<number[]>([])
  const clicks = ref(0)
  const bounds = ref<Bounds>({ width: 0, height: 0 })
  const radius = ref(0)

  let engine: EvasionEngine | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null
  let rippleSeq = 0
  let lastRippleTick: number | null = null
  const rippleTimeouts = new Set<ReturnType<typeof setTimeout>>()
  let cursor: Vec2 = { x: 0, y: 0 }
  let samples: [number, number][] = []
  let hits: DodgeLog['hits'] = []

  /** Tracks the latest cursor position for tick() to use, without a per-tick listener. */
  function onPointerMove(e: PointerEvent) {
    cursor = { x: e.clientX, y: e.clientY }
  }

  /**
   * Pulls the button's current position/radius from the engine into the
   * reactive refs the template renders. The dodge's curved glide is now
   * simulated inside the shared engine itself (see shared/evasionEngine.ts)
   * rather than being a client-only visual layered on top of an
   * instantly-teleporting position — so what's rendered here is always
   * exactly the same position hit-testing and evasion are reacting to, tick
   * for tick.
   */
  function syncFromEngine() {
    if (!engine) {
      return
    }
    const raw = engine.getRawCenter()
    x.value = raw.x
    y.value = raw.y
    radius.value = engine.getRadius()
  }

  /** One fixed-timestep frame: records the cursor sample, advances the engine, and syncs the render refs. */
  function tick() {
    if (!engine) {
      return
    }
    samples.push([cursor.x, cursor.y])
    engine.step(cursor)
    syncFromEngine()
  }

  /**
   * Starts (or skips) a hit-ring ripple animation for a hit landing on tick
   * tickIndex. A hit landing while the most recent ripple is still in its
   * first half is dropped rather than restarting it — otherwise rapid hits
   * kept resetting the ring back to scale 1 and it never visibly grew. Past
   * the halfway point, a fresh ripple starts and plays on top of the old one
   * instead of cutting it off.
   */
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
    }, RIPPLE_DURATION_MS)
    rippleTimeouts.add(timeoutId)
  }

  /** Handles a click/tap: tests it against the engine, and on a hit records it and plays the ripple effect. Returns whether it hit. */
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

  /** Starts a fresh round: resets round state and spins up a new engine + tick loop for the given seed/bounds. */
  function start(seed: number, roundBounds: Bounds) {
    samples = []
    hits = []
    clicks.value = 0
    bounds.value = roundBounds
    cursor = { x: roundBounds.width / 2, y: roundBounds.height / 2 }
    /**
     * Screen center, matching the idle button's resting position (index.vue)
     * so the round's first dodge is a continuous reaction rather than a
     * teleport — must stay identical to submit.post.ts's replay, which has
     * no other way to know where the round visually began.
     */
    engine = createEvasionEngine({
      seed,
      bounds: roundBounds,
      initialCenter: { x: roundBounds.width / 2, y: roundBounds.height / 2 },
    })
    syncFromEngine()
    window.addEventListener('pointermove', onPointerMove)
    intervalId = setInterval(tick, TICK_MS)
  }

  /** Stops the tick loop and ripple timers, and returns everything recorded during the round for submission. */
  function stop(): DodgeLog {
    if (intervalId) {
      clearInterval(intervalId)
    }
    intervalId = null
    window.removeEventListener('pointermove', onPointerMove)
    engine = null
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

  return { x, y, ripples, clicks, bounds, radius, start, stop, handlePointerDown }
}
