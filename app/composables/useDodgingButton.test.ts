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
  it('starts centered in the given bounds', () => {
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    expect(dodge.x.value).toBe(200)
    expect(dodge.y.value).toBe(150)
    expect(dodge.bounds.value).toEqual(BOUNDS)
    dodge.stop()
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
    const hit = dodge.handlePointerDown({
      clientX: dodge.x.value,
      clientY: dodge.y.value,
    } as PointerEvent)

    expect(hit).toBe(true)
    expect(dodge.clicks.value).toBe(1)
    expect([dodge.x.value, dodge.y.value]).not.toEqual([200, 150])
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

  it('flashes isHit on a successful hit and clears it after the timeout', () => {
    useTickTimers()
    const dodge = useDodgingButton()
    dodge.start(1, BOUNDS)
    dodge.handlePointerDown({ clientX: dodge.x.value, clientY: dodge.y.value } as PointerEvent)

    expect(dodge.isHit.value).toBe(true) // requestAnimationFrame stub runs synchronously
    vi.advanceTimersByTime(500)
    expect(dodge.isHit.value).toBe(false)
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
