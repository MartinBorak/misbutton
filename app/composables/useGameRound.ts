import type { QualificationResult } from '#shared/leaderboard'
import { ROUND_MS } from '#shared/roundConfig'

export type RoundPhase = 'idle' | 'starting' | 'playing' | 'ended'

/** Shown when a round is voided because the tab stopped being visible (see cancelRound). */
const TAB_HIDDEN_MESSAGE = 'Round cancelled — keep this tab visible while playing.'

interface StartResponse {
  roundId: string
  token: string
  seed: number
  startedAt: number
  bounds: { width: number; height: number }
}

interface SubmitResponse extends QualificationResult {
  clicks: number
}

/**
 * Owns the round state machine (idle -> starting -> playing -> ended) and is
 * the only place that talks to /api/round/*; useDodgingButton stays free of
 * network concerns so the animation loop never waits on it.
 */
export function useGameRound() {
  const dodge = useDodgingButton()

  const phase = ref<RoundPhase>('idle')
  const timeRemainingMs = ref(ROUND_MS)
  const finalClicks = ref(0)
  const qualifies = ref(false)
  const rank = ref(-1)
  const errorMessage = ref('')
  const resultReady = ref(false)

  let roundId = ''
  let token = ''
  let deadline = 0
  let countdownId: ReturnType<typeof setInterval> | null = null

  /** Stops the countdown interval, if one is running. */
  function clearCountdown() {
    if (countdownId) {
      clearInterval(countdownId)
    }
    countdownId = null
  }

  /** Requests a new round from the server and starts the client-side dodge/countdown loop. */
  async function startRound() {
    if (phase.value === 'starting' || phase.value === 'playing') {
      return
    }
    phase.value = 'starting'
    errorMessage.value = ''
    qualifies.value = false
    rank.value = -1
    resultReady.value = false

    try {
      const res = await $fetch<StartResponse>('/api/round/start', {
        method: 'POST',
        body: {
          width: window.innerWidth,
          height: window.innerHeight,
          webdriver: navigator.webdriver === true,
        },
      })
      /**
       * The tab can go away while /api/round/start is in flight, which would
       * otherwise begin a round that's throttled from its very first tick.
       */
      if (document.hidden) {
        phase.value = 'idle'
        errorMessage.value = TAB_HIDDEN_MESSAGE
        return
      }
      roundId = res.roundId
      token = res.token
      dodge.start(res.seed, res.bounds)
      deadline = Date.now() + ROUND_MS
      timeRemainingMs.value = ROUND_MS
      phase.value = 'playing'
      countdownId = setInterval(() => {
        const remaining = deadline - Date.now()
        timeRemainingMs.value = Math.max(remaining, 0)
        if (remaining <= 0) {
          endRound()
        }
      }, 100)
    } catch {
      phase.value = 'idle'
      errorMessage.value = 'Could not start a round — try again.'
    }
  }

  /** Ends the round locally and submits the recorded log to the server for the official score. */
  async function endRound() {
    if (phase.value !== 'playing') {
      return
    }
    clearCountdown()
    const log = dodge.stop()
    finalClicks.value = dodge.clicks.value
    phase.value = 'ended'

    try {
      const res = await $fetch<SubmitResponse>('/api/round/submit', {
        method: 'POST',
        body: { roundId, token, samples: log.samples, hits: log.hits },
      })
      finalClicks.value = res.clicks
      qualifies.value = res.qualifies
      rank.value = res.rank
    } catch (err) {
      console.error('Round submission failed:', err)
      errorMessage.value = 'Could not submit your score.'
    } finally {
      resultReady.value = true
    }
  }

  /** Claims a qualifying score under the given name for the leaderboard. */
  async function claim(name: string): Promise<boolean> {
    try {
      const res = await $fetch<QualificationResult>('/api/round/claim', {
        method: 'POST',
        body: { roundId, token, name },
      })
      qualifies.value = res.qualifies
      return res.qualifies
    } catch {
      return false
    }
  }

  /** Resets round state back to idle after a game-over screen. */
  function reset() {
    phase.value = 'idle'
    qualifies.value = false
    rank.value = -1
  }

  /**
   * Voids an in-flight round instead of submitting it.
   *
   * Browsers throttle timers in hidden tabs to roughly 1/sec, so a round
   * played in the background records a small fraction of the ~1200 samples
   * the server expects and gets rejected at submit time — after the player
   * has already spent the whole round. Nothing worth recording happens while
   * hidden anyway (the cursor isn't moving), so drop the round the moment the
   * tab goes away rather than failing 60 seconds later.
   */
  function cancelRound() {
    if (phase.value !== 'playing') {
      return
    }
    clearCountdown()
    dodge.stop()
    phase.value = 'idle'
    errorMessage.value = TAB_HIDDEN_MESSAGE
  }

  /** Voids the round whenever the tab stops being visible (see cancelRound). */
  function onVisibilityChange() {
    if (document.hidden) {
      cancelRound()
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onUnmounted(() => {
    clearCountdown()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    phase,
    timeRemainingMs,
    finalClicks,
    liveClicks: dodge.clicks,
    qualifies,
    rank,
    errorMessage,
    resultReady,
    dodgeX: dodge.x,
    dodgeY: dodge.y,
    dodgeRipples: dodge.ripples,
    dodgeBounds: dodge.bounds,
    dodgeRadius: dodge.radius,
    handlePointerDown: dodge.handlePointerDown,
    startRound,
    claim,
    reset,
  }
}
