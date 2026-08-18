import { ROUND_MS } from '#shared/roundConfig'

export type RoundPhase = 'idle' | 'starting' | 'playing' | 'ended'

interface StartResponse {
  roundId: string
  token: string
  seed: number
  startedAt: number
  bounds: { width: number; height: number }
}

interface SubmitResponse {
  clicks: number
  qualifies: boolean
  rank: number
}

interface ClaimResponse {
  qualifies: boolean
  rank: number
}

// Owns the round state machine (idle -> starting -> playing -> ended) and is
// the only place that talks to /api/round/*; useDodgingButton stays free of
// network concerns so the animation loop never waits on it.
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

  function clearCountdown() {
    if (countdownId) {
      clearInterval(countdownId)
    }
    countdownId = null
  }

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

  async function claim(name: string): Promise<boolean> {
    try {
      const res = await $fetch<ClaimResponse>('/api/round/claim', {
        method: 'POST',
        body: { roundId, token, name },
      })
      qualifies.value = res.qualifies
      return res.qualifies
    } catch {
      return false
    }
  }

  function reset() {
    phase.value = 'idle'
    qualifies.value = false
    rank.value = -1
  }

  onUnmounted(clearCountdown)

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
    dodgeIsHit: dodge.isHit,
    handlePointerDown: dodge.handlePointerDown,
    startRound,
    claim,
    reset,
  }
}
