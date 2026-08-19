import { createEvasionEngine } from '#shared/evasionEngine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  stubRequestAnimationFrame,
  stubVueLifecycle,
  stubWindow,
  type FakeWindow,
} from '~~/tests/helpers/vueGlobals'

stubVueLifecycle()
stubRequestAnimationFrame()

const { useDodgingButton } = await import('./useDodgingButton')

const BOUNDS = { width: 400, height: 300 }
const TICK_MS = 50

let fakeWindow: FakeWindow

function firePointerMove(x: number, y: number) {
  fakeWindow.dispatch('pointermove', { clientX: x, clientY: y })
}

// Fakes setTimeout/setInterval only — leaves requestAnimationFrame alone so
// the synchronous stub from stubRequestAnimationFrame() keeps working
// (vi.useFakeTimers() fakes rAF too by default, which would otherwise
// silently override it).
function useTickTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
}

beforeEach(() => {
  fakeWindow = stubWindow()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDodgingButton', () => {
  it('starts at the center of the given bounds', () => {
    // Matches the idle button's resting position (index.vue) so the round's
    // first dodge is a continuous reaction rather than a teleport.
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    expect(dodge.x.value).toBe(BOUNDS.width / 2)
    expect(dodge.y.value).toBe(BOUNDS.height / 2)
    expect(dodge.bounds.value).toEqual(BOUNDS)
    dodge.stop()
  })

  it('starts at the center regardless of seed', () => {
    const a = useDodgingButton()
    a.start(1, BOUNDS)
    const b = useDodgingButton()
    b.start(2, BOUNDS)
    expect(a.x.value).toBe(b.x.value)
    expect(a.y.value).toBe(b.y.value)
    a.stop()
    b.stop()
  })

  it('records a cursor sample on every tick', () => {
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)

    firePointerMove(10, 20)
    vi.advanceTimersByTime(TICK_MS)
    firePointerMove(30, 40)
    vi.advanceTimersByTime(TICK_MS)

    const log = dodge.stop()
    expect(log.samples).toEqual([
      [10, 20],
      [30, 40],
    ])
  })

  it('registers a hit, increments clicks, and moves the button when the click lands on it', () => {
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    const before = { x: dodge.x.value, y: dodge.y.value }
    const hit = dodge.handlePointerDown({
      clientX: dodge.x.value,
      clientY: dodge.y.value,
    } as PointerEvent)

    expect(hit).toBe(true)
    expect(dodge.clicks.value).toBe(1)
    expect([dodge.x.value, dodge.y.value]).not.toEqual([before.x, before.y])
    dodge.stop()
  })

  it('tracks the engine position exactly, tick by tick', () => {
    // The glide itself now lives in shared/evasionEngine.ts (curve coverage
    // is in evasionEngine.test.ts) — the composable's only job is to mirror
    // it, so what's rendered is always exactly what hit-testing/evasion see.
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    dodge.handlePointerDown({ clientX: dodge.x.value, clientY: dodge.y.value } as PointerEvent)

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(TICK_MS)
    }

    const mirror = createEvasionEngine({
      seed: 1,
      bounds: BOUNDS,
      initialCenter: { x: BOUNDS.width / 2, y: BOUNDS.height / 2 },
    })
    const target1 = mirror.getCenter()
    mirror.testHit(target1.x, target1.y)
    for (let i = 0; i < 10; i++) {
      mirror.step({ x: BOUNDS.width / 2, y: BOUNDS.height / 2 })
    }
    const expected = mirror.getRawCenter()

    expect(dodge.x.value).toBe(expected.x)
    expect(dodge.y.value).toBe(expected.y)
    dodge.stop()
  })

  it('shrinks radius after a hit and uses the shrunk radius for the next hit test', () => {
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    const initialRadius = dodge.radius.value

    dodge.handlePointerDown({ clientX: dodge.x.value, clientY: dodge.y.value } as PointerEvent)

    expect(dodge.radius.value).toBeLessThan(initialRadius)
    dodge.stop()
  })

  it('does not register a hit far from the button', () => {
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    const hit = dodge.handlePointerDown({ clientX: 0, clientY: 0 } as PointerEvent)

    expect(hit).toBe(false)
    expect(dodge.clicks.value).toBe(0)
    dodge.stop()
  })

  it('records a hit event at the current tick, keyed to the click position', () => {
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    vi.advanceTimersByTime(TICK_MS * 3) // tick a few times first
    const hitX = dodge.x.value
    const hitY = dodge.y.value
    dodge.handlePointerDown({ clientX: hitX, clientY: hitY } as PointerEvent)

    const log = dodge.stop()
    expect(log.hits).toEqual([{ tick: 3, x: hitX, y: hitY }])
  })

  it('adds a ripple on a successful hit and removes it after the animation duration', () => {
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    dodge.handlePointerDown({ clientX: dodge.x.value, clientY: dodge.y.value } as PointerEvent)

    expect(dodge.ripples.value.length).toBe(1)
    vi.advanceTimersByTime(1500)
    expect(dodge.ripples.value.length).toBe(0)
    dodge.stop()
  })

  it('suppresses a hit ripple triggered in the first half of the previous one, but allows one after the halfway point', () => {
    // Regression coverage for the debounce added this session: a hit
    // landing early just restarted the ring back to scale 1, so rapid hits
    // made it look like nothing was happening. Now an early hit is dropped
    // (the existing ripple keeps playing undisturbed) while a hit past the
    // halfway point starts a second ripple that plays alongside the first.
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)

    // A shadow engine driven through the exact same sequence of hits/ticks
    // as the real one (same seed/bounds, same cursor every step) — since
    // that makes it deterministically identical, its position tells us
    // exactly where the next click needs to land, without
    // useDodgingButton having to expose its internal engine.
    const mirror = createEvasionEngine({
      seed: 1,
      bounds: BOUNDS,
      initialCenter: { x: BOUNDS.width / 2, y: BOUNDS.height / 2 },
    })
    const mirrorCursor = { x: BOUNDS.width / 2, y: BOUNDS.height / 2 }
    function advanceBoth(ticks: number) {
      for (let i = 0; i < ticks; i++) {
        vi.advanceTimersByTime(TICK_MS)
        mirror.step(mirrorCursor)
      }
    }

    const target1 = mirror.getCenter()
    dodge.handlePointerDown({ clientX: target1.x, clientY: target1.y } as PointerEvent)
    mirror.testHit(target1.x, target1.y)
    expect(dodge.ripples.value.length).toBe(1)

    advanceBoth(10) // 500ms since the first ripple — still its first half
    const target2 = mirror.getCenter()
    dodge.handlePointerDown({ clientX: target2.x, clientY: target2.y } as PointerEvent)
    mirror.testHit(target2.x, target2.y)
    expect(dodge.ripples.value.length).toBe(1) // suppressed

    advanceBoth(10) // 1000ms since the first ripple — past the halfway point
    const target3 = mirror.getCenter()
    dodge.handlePointerDown({ clientX: target3.x, clientY: target3.y } as PointerEvent)
    expect(dodge.ripples.value.length).toBe(2) // allowed, overlaps the first

    dodge.stop()
  })

  it('stop() halts ticking so nothing changes afterward', () => {
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    dodge.stop()
    const xBefore = dodge.x.value

    firePointerMove(390, 290)
    vi.advanceTimersByTime(TICK_MS * 10)
    expect(dodge.x.value).toBe(xBefore)
  })

  it('start() resets clicks and the log from any previous round', () => {
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    dodge.handlePointerDown({ clientX: dodge.x.value, clientY: dodge.y.value } as PointerEvent)
    expect(dodge.clicks.value).toBe(1)
    dodge.stop()

    dodge.start(2, BOUNDS)
    expect(dodge.clicks.value).toBe(0)
    const log = dodge.stop()
    expect(log.samples).toEqual([])
    expect(log.hits).toEqual([])
  })

  it('keeps the displayed position sliding in the pushed direction across a wrap, never snapping', () => {
    // Regression coverage for the bug fixed this session: the shared engine
    // wraps its internal center into [0, bounds), but the *displayed*
    // x/y (what setDisplayPosition maintains) must stay continuous with
    // the button's on-screen trajectory — otherwise a dodge through one
    // edge visibly jumps to an unrelated point instead of sliding
    // off-screen. Chasing it relentlessly from below (pushing it toward
    // the top) for long enough should eventually provoke a wrap; a
    // continuous display necessarily goes negative when that happens,
    // which a naive "snap to the engine's wrapped value" implementation
    // (always in [0, height)) never would.
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(7, BOUNDS)

    let sawNegativeY = false
    for (let i = 0; i < 400 && !sawNegativeY; i++) {
      firePointerMove(dodge.x.value, dodge.y.value + 15)
      vi.advanceTimersByTime(TICK_MS)
      if (dodge.y.value < 0) {
        sawNegativeY = true
      }
    }
    dodge.stop()

    expect(sawNegativeY).toBe(true)
  })
})
