import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { ROUND_MS } from '~~/shared/roundConfig'
import {
  stubDocument,
  stubFetch,
  stubNavigator,
  stubVueLifecycle,
  stubWindow,
} from '~~/tests/helpers/vueGlobals'

stubVueLifecycle()

/**
 * useGameRound.ts calls the auto-imported useDodgingButton() itself — stub it
 * with a plain controllable fake rather than the real evasion engine, so
 * these tests exercise only useGameRound's own orchestration (phase
 * transitions, network calls, error handling), independently of the engine
 * (already covered by shared/evasionEngine.test.ts and
 * useDodgingButton.test.ts).
 */
function createFakeDodge() {
  return {
    x: ref(0),
    y: ref(0),
    ripples: ref([]),
    clicks: ref(0),
    bounds: ref({ width: 0, height: 0 }),
    start: vi.fn(),
    stop: vi.fn(() => ({ samples: [[1, 2]], hits: [{ tick: 0, x: 1, y: 2 }] })),
    setOrigin: vi.fn(),
    handlePointerDown: vi.fn(() => true),
  }
}

/**
 * Stands in for the arena element useGameRound measures a round's bounds and
 * coordinate origin from — a bare rect is the whole surface it touches.
 */
function fakeArena(left: number, top: number, width: number, height: number) {
  return ref({
    getBoundingClientRect: () => ({ left, top, width, height }),
  } as unknown as HTMLElement)
}

let fakeDodge: ReturnType<typeof createFakeDodge>
let fetchMock: ReturnType<typeof stubFetch>
let fakeDocument: ReturnType<typeof stubDocument>
let fakeWindow: ReturnType<typeof stubWindow>

const { useGameRound } = await import('./useGameRound')

beforeEach(() => {
  fakeDodge = createFakeDodge()
  vi.stubGlobal('useDodgingButton', () => fakeDodge)
  fakeWindow = stubWindow(800, 600)
  stubNavigator(false)
  fakeDocument = stubDocument()
  fetchMock = stubFetch()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const START_RESPONSE = {
  roundId: 'round-1',
  token: 'token-1',
  seed: 42,
  startedAt: 0,
  bounds: { width: 800, height: 600 },
}

describe('useGameRound — initial state', () => {
  it('starts idle with a full countdown and no error', () => {
    const game = useGameRound()
    expect(game.phase.value).toBe('idle')
    expect(game.timeRemainingMs.value).toBe(ROUND_MS)
    expect(game.errorMessage.value).toBe('')
  })
})

describe('useGameRound — startRound', () => {
  it('requests a round with the viewport size and webdriver flag, then enters playing', async () => {
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    const game = useGameRound()

    await game.startRound()

    expect(fetchMock).toHaveBeenCalledWith('/api/round/start', {
      method: 'POST',
      body: { width: 800, height: 600, webdriver: false },
    })
    expect(fakeDodge.start).toHaveBeenCalledWith(
      42,
      { width: 800, height: 600 },
      { x: 0, y: 0 }, // no arena element: the whole viewport is the play area
    )
    expect(game.phase.value).toBe('playing')
    expect(game.timeRemainingMs.value).toBe(ROUND_MS)
  })

  it('reports the arena rect, not the viewport, and starts the round at its origin', async () => {
    /**
     * The play area is inset from the viewport by the HUD band above it and
     * the footer band below (see main.css), so the button can't end up
     * pressed against the browser's own chrome. That inset is only real if
     * the round is sized and positioned by the arena's rect: bounds smaller
     * than the window, and an origin every incoming pointer coordinate is
     * measured from.
     */
    fetchMock.mockResolvedValueOnce({ ...START_RESPONSE, bounds: { width: 800, height: 460 } })
    const game = useGameRound(fakeArena(0, 140, 800, 460))

    await game.startRound()

    expect(fetchMock).toHaveBeenCalledWith('/api/round/start', {
      method: 'POST',
      body: { width: 800, height: 460, webdriver: false },
    })
    expect(fakeDodge.start).toHaveBeenCalledWith(42, { width: 800, height: 460 }, { x: 0, y: 140 })
  })

  it('plays the round against the bounds the server echoed back, not the measured ones', async () => {
    /**
     * The server rounds and clamps whatever dimensions it's told
     * (start.post.ts) and replays the round against the result, so a client
     * that kept using its own measurement would have every hit rejected at
     * submit time.
     */
    fetchMock.mockResolvedValueOnce({ ...START_RESPONSE, bounds: { width: 800, height: 320 } })
    const game = useGameRound(fakeArena(0, 140, 800, 299.5))

    await game.startRound()

    expect(fakeDodge.start).toHaveBeenCalledWith(42, { width: 800, height: 320 }, expect.anything())
  })

  it('reports webdriver: true when navigator.webdriver is set', async () => {
    stubNavigator(true)
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    const game = useGameRound()

    await game.startRound()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/round/start',
      expect.objectContaining({ body: expect.objectContaining({ webdriver: true }) }),
    )
  })

  it('ignores a second call while already starting or playing', async () => {
    fetchMock.mockResolvedValue(START_RESPONSE)
    const game = useGameRound()

    const first = game.startRound()
    await game.startRound() // fired while the first call is still in flight ('starting')
    await first

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to idle with an error message when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const game = useGameRound()

    await game.startRound()

    expect(game.phase.value).toBe('idle')
    expect(game.errorMessage.value).toBe('Could not start a round — try again.')
    expect(fakeDodge.start).not.toHaveBeenCalled()
  })
})

describe('useGameRound — round end (via the countdown reaching zero)', () => {
  it('stops the dodge log, submits it, and applies the server result', async () => {
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    const game = useGameRound()
    await game.startRound()

    fakeDodge.clicks.value = 7
    fetchMock.mockResolvedValueOnce({ clicks: 9, qualifies: true, rank: 2 })

    await vi.advanceTimersByTimeAsync(ROUND_MS + 200)

    expect(fakeDodge.stop).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/api/round/submit', {
      method: 'POST',
      body: {
        roundId: 'round-1',
        token: 'token-1',
        samples: [[1, 2]],
        hits: [{ tick: 0, x: 1, y: 2 }],
      },
    })
    expect(game.phase.value).toBe('ended')
    expect(game.finalClicks.value).toBe(9) // overwritten by the server's authoritative count
    expect(game.qualifies.value).toBe(true)
    expect(game.rank.value).toBe(2)
    expect(game.resultReady.value).toBe(true)
  })

  it('shows an error and still marks the result ready when submission fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    const game = useGameRound()
    await game.startRound()

    fetchMock.mockRejectedValueOnce(new Error('rejected'))
    await vi.advanceTimersByTimeAsync(ROUND_MS + 200)

    expect(game.errorMessage.value).toBe('Could not submit your score.')
    expect(game.resultReady.value).toBe(true)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('useGameRound — claim', () => {
  async function playThroughToEnded(game: ReturnType<typeof useGameRound>) {
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    await game.startRound()
    fetchMock.mockResolvedValueOnce({ clicks: 3, qualifies: true, rank: 1 })
    await vi.advanceTimersByTimeAsync(ROUND_MS + 200)
  }

  it('submits the name and updates qualifies from the response', async () => {
    const game = useGameRound()
    await playThroughToEnded(game)

    fetchMock.mockResolvedValueOnce({ qualifies: true, rank: 1 })
    const result = await game.claim('Martin')

    expect(fetchMock).toHaveBeenLastCalledWith('/api/round/claim', {
      method: 'POST',
      body: { roundId: 'round-1', token: 'token-1', name: 'Martin' },
    })
    expect(result).toBe(true)
    expect(game.qualifies.value).toBe(true)
  })

  it('returns false without throwing when the claim request fails', async () => {
    const game = useGameRound()
    await playThroughToEnded(game)

    fetchMock.mockRejectedValueOnce(new Error('rejected'))
    const result = await game.claim('Martin')

    expect(result).toBe(false)
  })
})

describe('useGameRound — reset', () => {
  it('returns to idle and clears the qualification result', async () => {
    const game = useGameRound()
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    await game.startRound()
    fetchMock.mockResolvedValueOnce({ clicks: 5, qualifies: true, rank: 1 })
    await vi.advanceTimersByTimeAsync(ROUND_MS + 200)

    game.reset()

    expect(game.phase.value).toBe('idle')
    expect(game.qualifies.value).toBe(false)
    expect(game.rank.value).toBe(-1)
  })
})

describe('useGameRound — a resize that moves the arena', () => {
  it('re-points the coordinate origin at the arena mid-round', async () => {
    /**
     * The bands are sized off the viewport, so a resize slides the arena up
     * or down. The round's bounds stay frozen either way (the server is
     * replaying against them), but the button is drawn inside the arena —
     * without following the move, every click for the rest of the round
     * lands offset from the button it was aimed at.
     */
    const arena = fakeArena(0, 140, 800, 460)
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    const game = useGameRound(arena)
    await game.startRound()

    arena.value = fakeArena(0, 96, 800, 380).value
    fakeWindow.dispatch('resize', {})

    expect(fakeDodge.setOrigin).toHaveBeenCalledWith({ x: 0, y: 96 })
  })

  it('leaves the origin alone when no round is running', () => {
    useGameRound(fakeArena(0, 140, 800, 460))

    fakeWindow.dispatch('resize', {})

    expect(fakeDodge.setOrigin).not.toHaveBeenCalled()
  })
})

describe('useGameRound — hidden tab', () => {
  it('voids an in-flight round instead of submitting a throttled one', async () => {
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    const game = useGameRound()
    await game.startRound()
    expect(game.phase.value).toBe('playing')

    fakeDocument.setHidden(true)

    expect(game.phase.value).toBe('idle')
    expect(game.errorMessage.value).toMatch(/tab visible/i)
    expect(fakeDodge.stop).toHaveBeenCalled()
    // Only the start call — the round must never reach /api/round/submit.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not submit even after the full round duration elapses', async () => {
    fetchMock.mockResolvedValueOnce(START_RESPONSE)
    const game = useGameRound()
    await game.startRound()
    fakeDocument.setHidden(true)

    await vi.advanceTimersByTimeAsync(ROUND_MS + 200)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(game.phase.value).toBe('idle')
  })

  it('abandons a round whose tab went away while /api/round/start was in flight', async () => {
    fetchMock.mockImplementationOnce(async () => {
      fakeDocument.setHidden(true)
      return START_RESPONSE
    })
    const game = useGameRound()
    await game.startRound()

    expect(game.phase.value).toBe('idle')
    expect(game.errorMessage.value).toMatch(/tab visible/i)
    expect(fakeDodge.start).not.toHaveBeenCalled()
  })

  it('ignores visibility changes when no round is running', async () => {
    const game = useGameRound()
    fakeDocument.setHidden(true)

    expect(game.phase.value).toBe('idle')
    expect(game.errorMessage.value).toBe('')
  })
})
