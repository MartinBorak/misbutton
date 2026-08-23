<script setup lang="ts">
  import { initialButtonRadius, initialTriggerRadius } from '#shared/evasionEngine'
  import {
    BAND_BOTTOM_MAX_REM,
    BAND_BOTTOM_MIN_REM,
    BAND_TOP_MAX_REM,
    BAND_TOP_MIN_REM,
  } from '#shared/layout'
  import { ROUND_MS } from '#shared/roundConfig'
  import { measureArena } from '~/utils/arena'

  const roundSeconds = ROUND_MS / 1000

  /**
   * The band heights main.css sizes the arena's inset with. They're defined
   * in #shared/layout rather than in the stylesheet because the server
   * derives its out-of-bounds tolerance from the same numbers — see
   * server/api/round/submit.post.ts.
   */
  const bandStyle = {
    '--band-top-min': `${BAND_TOP_MIN_REM}rem`,
    '--band-top-max': `${BAND_TOP_MAX_REM}rem`,
    '--band-bottom-min': `${BAND_BOTTOM_MIN_REM}rem`,
    '--band-bottom-max': `${BAND_BOTTOM_MAX_REM}rem`,
  }

  const pointerCapable = usePointerCapability()
  const { theme, toggle } = useTheme()
  const leaderboard = useLeaderboard()

  /**
   * The play area proper, inset from the viewport by the HUD band above and
   * the footer band below (see main.css). Everything positional — a round's
   * bounds, the coordinate origin, the idle button's resting spot — is
   * measured off this element rather than off the window.
   */
  const arenaElement = ref<HTMLElement | null>(null)

  const {
    phase,
    timeRemainingMs,
    finalClicks,
    liveClicks,
    qualifies,
    rank,
    errorMessage,
    resultReady,
    dodgeX,
    dodgeY,
    dodgeRipples,
    dodgeBounds,
    dodgeRadius,
    handlePointerDown,
    startRound,
    claim,
    reset,
  } = useGameRound(arenaElement)

  const nameHandled = ref(false)

  watch(phase, (value) => {
    if (value !== 'ended') {
      nameHandled.value = false
    }
  })

  const roundResultReady = computed(() => phase.value === 'ended' && resultReady.value)
  const awaitingName = computed(
    () => roundResultReady.value && qualifies.value && !nameHandled.value,
  )
  const showGameOver = computed(
    () => roundResultReady.value && (!qualifies.value || nameHandled.value),
  )

  /** Claims the score under the entered name and refreshes the leaderboard. */
  async function onNameSubmit(name: string) {
    await claim(name)
    nameHandled.value = true
    leaderboard.refresh()
  }

  /** Dismisses the name-entry prompt without claiming a leaderboard spot. */
  function onNameSkip() {
    nameHandled.value = true
  }

  /** Resets round state and immediately starts a new round. */
  function onPlayAgain() {
    reset()
    startRound()
  }

  /**
   * No explicit "Play" click — the idle button sits at screen center (where
   * a fresh round's engine also starts it, see useDodgingButton.ts) and the
   * round starts once the cursor gets close enough, so the button's first
   * reaction *is* the start of the round rather than a separate step before
   * it. This first trigger fires wider than a mid-game dodge's, purely to
   * buy time for the /api/round/start round-trip: it's the one moment
   * startRound() is on the critical path between the cursor arriving and
   * the button actually moving, so without the extra margin, network
   * latency reads as the button freezing right as the cursor reaches it.
   */
  const IDLE_TRIGGER_RADIUS_MULTIPLIER = 2
  const idleButtonDiameter = ref(0)
  const idlePulseDelay = usePulseSync()
  let idleCenter = { x: 0, y: 0 }
  let idleTriggerRadius = 0

  /**
   * Recomputes the idle button's size/position/trigger radius for the
   * current arena. idleCenter stays in viewport coordinates, since it's
   * compared against raw pointer events in onIdlePointerMove.
   */
  function computeIdleGeometry() {
    const { origin, bounds } = measureArena(arenaElement.value)
    idleButtonDiameter.value = initialButtonRadius(bounds) * 2
    idleTriggerRadius = initialTriggerRadius(bounds) * IDLE_TRIGGER_RADIUS_MULTIPLIER
    idleCenter = { x: origin.x + bounds.width / 2, y: origin.y + bounds.height / 2 }
  }

  /** Starts a round once the cursor gets within the idle trigger radius. */
  function onIdlePointerMove(e: PointerEvent) {
    const dist = Math.hypot(e.clientX - idleCenter.x, e.clientY - idleCenter.y)
    if (dist < idleTriggerRadius) {
      window.removeEventListener('pointermove', onIdlePointerMove)
      startRound()
    }
  }

  /**
   * Arms the idle proximity listener only while idle. Driven both by phase
   * changes and once on mount — the watcher can't be `immediate`, since it
   * touches `window` and setup also runs on the server.
   */
  function syncIdleListener(value: RoundPhase) {
    window.removeEventListener('pointermove', onIdlePointerMove)
    if (value === 'idle') {
      computeIdleGeometry()
      window.addEventListener('pointermove', onIdlePointerMove)
    }
  }

  watch(phase, syncIdleListener)

  onUnmounted(() => {
    window.removeEventListener('pointermove', onIdlePointerMove)
  })

  onMounted(() => {
    leaderboard.refresh()
    syncIdleListener(phase.value)
  })
</script>

<template>
  <div
    class="play-field"
    :style="bandStyle"
  >
    <UnsupportedDeviceNotice v-if="pointerCapable === false" />

    <template v-else>
      <GameHud
        :time-remaining-ms="timeRemainingMs"
        :clicks="liveClicks"
        :theme="theme"
        :entries="leaderboard.entries.value"
        :show-stats="phase === 'playing'"
        @toggle-theme="toggle"
      />

      <div
        ref="arenaElement"
        class="arena"
      >
        <DodgeButton
          v-if="phase === 'playing'"
          :x="dodgeX"
          :y="dodgeY"
          :ripples="dodgeRipples"
          :bounds="dodgeBounds"
          :radius="dodgeRadius"
          @pointerdown="handlePointerDown"
        />

        <div
          v-if="phase === 'idle' || phase === 'starting'"
          class="idle-button"
          :style="{
            '--button-diameter': `${idleButtonDiameter}px`,
            '--idle-pulse-duration': `${IDLE_PULSE_PERIOD_MS}ms`,
            'animation-delay': idlePulseDelay,
          }"
          aria-hidden="true"
        />

        <Transition name="idle-text">
          <div
            v-if="phase === 'idle'"
            class="idle-card"
          >
            <h1>Catch me</h1>

            <p>{{ roundSeconds }} seconds. I really don't want to be clicked.</p>
          </div>
        </Transition>

        <p
          v-if="phase === 'ended' && !resultReady"
          class="result-pending"
        >
          Tallying your score…
        </p>
      </div>

      <GameFooter :interactive="phase !== 'playing'" />

      <p
        v-if="errorMessage"
        class="error-toast"
      >
        {{ errorMessage }}
      </p>
    </template>

    <NameEntryModal
      :show="awaitingName"
      :rank="rank"
      :clicks="finalClicks"
      @submit="onNameSubmit"
      @skip="onNameSkip"
    />

    <GameOverModal
      :show="showGameOver"
      :clicks="finalClicks"
      @play-again="onPlayAgain"
    />
  </div>
</template>
