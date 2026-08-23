import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROUND_MS } from '#shared/roundConfig'
import { fakeEvent, stubServerApiBasics, stubStorage } from '~~/tests/helpers/nuxtGlobals'
import { stubVueLifecycle, stubWindow, type FakeWindow } from '~~/tests/helpers/vueGlobals'

/**
 * End-to-end coverage for the one thing unit tests on either side keep
 * missing: a round recorded by the real client composable has to survive the
 * real server validator.
 *
 * The two halves disagreeing is not hypothetical — the arena inset broke
 * exactly this. The client records in arena coordinates while the player's
 * cursor roams the whole window, so perfectly ordinary play produces samples
 * outside the round's bounds, and the server rejected every such round after
 * the player had already spent sixty seconds on it.
 */
stubVueLifecycle()
stubServerApiBasics()

const { issueRoundToken, verifyRoundToken } = await import('~~/server/utils/roundToken')
const { getRoundResult, markRoundUsed } = await import('~~/server/utils/roundGuard')
const { wouldQualify } = await import('~~/server/utils/leaderboardStore')
const { readBodySafe } = await import('~~/server/utils/readBodySafe')
const { requireRoundPayload } = await import('~~/server/utils/requireRoundPayload')

vi.stubGlobal('verifyRoundToken', verifyRoundToken)
vi.stubGlobal('getRoundResult', getRoundResult)
vi.stubGlobal('markRoundUsed', markRoundUsed)
vi.stubGlobal('wouldQualify', wouldQualify)
vi.stubGlobal('readBodySafe', readBodySafe)
vi.stubGlobal('requireRoundPayload', requireRoundPayload)

const handlerModule = await import('~~/server/api/round/submit.post')
const submitHandler = handlerModule.default as (event: unknown) => Promise<unknown>

const { useDodgingButton } = await import('~/composables/useDodgingButton')

const TICK_MS = 50
const TOTAL_TICKS = Math.round(ROUND_MS / TICK_MS)

/** A typical desktop window, and the arena the bands leave inside it. */
const VIEWPORT = { width: 1440, height: 900 }
const BAND_TOP = 140
const BAND_BOTTOM = 72
const ARENA = { width: VIEWPORT.width, height: VIEWPORT.height - BAND_TOP - BAND_BOTTOM }
const ORIGIN = { x: 0, y: BAND_TOP }

let fakeWindow: FakeWindow

beforeEach(() => {
  fakeWindow = stubWindow(VIEWPORT.width, VIEWPORT.height)
  stubStorage()
  // Date included: the handler checks a round's elapsed wall-clock time.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * A cursor path in *viewport* coordinates that covers the whole window,
 * bands included — chasing the button up into the leaderboard and down over
 * the footer is ordinary play, not an edge case. Slow enough that no step
 * reads as a teleport.
 */
function cursorAt(tick: number) {
  const t = tick / TOTAL_TICKS
  return {
    clientX: VIEWPORT.width * (0.5 + 0.5 * Math.sin(t * 40)),
    clientY: VIEWPORT.height * (0.5 + 0.5 * Math.cos(t * 26)),
  }
}

/** Plays a full round through the real composable and returns its recorded log. */
function playRound(seed: number) {
  const dodge = useDodgingButton()
  dodge.start(seed, ARENA, ORIGIN)

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    fakeWindow.dispatch('pointermove', cursorAt(tick))
    // Every so often, click wherever the button currently is.
    if (tick % 120 === 0) {
      dodge.handlePointerDown({
        clientX: ORIGIN.x + dodge.x.value,
        clientY: ORIGIN.y + dodge.y.value,
      } as PointerEvent)
    }
    vi.advanceTimersByTime(TICK_MS)
  }

  return { log: dodge.stop(), clicks: dodge.clicks.value }
}

describe('a recorded round survives server validation', () => {
  it('accepts a full round played across the whole window, bands included', async () => {
    vi.setSystemTime(0)
    const { roundId, token, seed } = issueRoundToken(ARENA, false)

    // The real client plays the seed the server issued, so the replay matches.
    const { log, clicks } = playRound(seed)

    // The player really did wander into both bands — otherwise this proves nothing.
    const verticalPositions = log.samples.map(([, y]) => y)
    expect(Math.min(...verticalPositions)).toBeLessThan(0)
    expect(Math.max(...verticalPositions)).toBeGreaterThan(ARENA.height)
    expect(clicks).toBeGreaterThan(0)

    // Playing the round advanced the faked clock by exactly ROUND_MS.
    await expect(
      submitHandler(fakeEvent({ roundId, token, samples: log.samples, hits: log.hits })),
    ).resolves.toMatchObject({ clicks })
  })
})
