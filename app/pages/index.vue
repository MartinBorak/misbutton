<script setup lang="ts">
  import { DEFAULT_CONFIG } from '#shared/evasionEngine'

  const pointerCapable = usePointerCapability()
  const { theme, toggle } = useTheme()
  const leaderboard = useLeaderboard()
  const isDev = import.meta.dev

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
    dodgeDebugInfo,
    handlePointerDown,
    startRound,
    claim,
    reset,
  } = useGameRound()

  const nameHandled = ref(false)

  watch(phase, (value) => {
    if (value !== 'ended') {
      nameHandled.value = false
    }
  })

  const awaitingName = computed(
    () => phase.value === 'ended' && resultReady.value && qualifies.value && !nameHandled.value,
  )
  const showGameOver = computed(
    () => phase.value === 'ended' && resultReady.value && (!qualifies.value || nameHandled.value),
  )

  async function onNameSubmit(name: string) {
    await claim(name)
    nameHandled.value = true
    leaderboard.refresh()
  }

  function onNameSkip() {
    nameHandled.value = true
  }

  function onPlayAgain() {
    reset()
    startRound()
  }

  // No explicit "Play" click — the idle button sits at screen center (where
  // a fresh round's engine also starts it, see useDodgingButton.ts) and the
  // round starts once the cursor gets close enough, so the button's first
  // reaction *is* the start of the round rather than a separate step before
  // it. This first trigger fires wider than a mid-game dodge's, purely to
  // buy time for the /api/round/start round-trip: it's the one moment
  // startRound() is on the critical path between the cursor arriving and
  // the button actually moving, so without the extra margin, network
  // latency reads as the button freezing right as the cursor reaches it.
  const IDLE_TRIGGER_RADIUS_MULTIPLIER = 2
  const idleButtonDiameter = ref(0)
  const idlePulseDelay = usePulseSync(2600)
  let idleCenter = { x: 0, y: 0 }
  let idleTriggerRadius = 0

  function computeIdleGeometry() {
    const minDim = Math.min(window.innerWidth, window.innerHeight)
    idleButtonDiameter.value = DEFAULT_CONFIG.buttonRadiusFrac * minDim * 2
    idleTriggerRadius = DEFAULT_CONFIG.triggerRadiusFrac * minDim * IDLE_TRIGGER_RADIUS_MULTIPLIER
    idleCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }

  function onIdlePointerMove(e: PointerEvent) {
    const dist = Math.hypot(e.clientX - idleCenter.x, e.clientY - idleCenter.y)
    if (dist < idleTriggerRadius) {
      window.removeEventListener('pointermove', onIdlePointerMove)
      startRound()
    }
  }

  watch(phase, (value) => {
    window.removeEventListener('pointermove', onIdlePointerMove)
    if (value === 'idle') {
      computeIdleGeometry()
      window.addEventListener('pointermove', onIdlePointerMove)
    }
  })

  onUnmounted(() => {
    window.removeEventListener('pointermove', onIdlePointerMove)
  })

  onMounted(() => {
    leaderboard.refresh()
    if (phase.value === 'idle') {
      computeIdleGeometry()
      window.addEventListener('pointermove', onIdlePointerMove)
    }
  })
</script>

<template>
  <div class="play-field">
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

      <DodgeButton
        v-if="phase === 'playing'"
        :x="dodgeX"
        :y="dodgeY"
        :ripples="dodgeRipples"
        :bounds="dodgeBounds"
        :radius="dodgeRadius"
        @pointerdown="handlePointerDown"
      />

      <DevParamsPanel
        v-if="isDev"
        :info="dodgeDebugInfo"
      />

      <div
        v-if="phase === 'idle' || phase === 'starting'"
        class="idle-button"
        :style="{
          '--button-diameter': `${idleButtonDiameter}px`,
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

          <p>60 seconds. I really don't want to be clicked.</p>
        </div>
      </Transition>

      <p
        v-if="phase === 'ended' && !resultReady"
        class="result-pending"
      >
        Tallying your score…
      </p>

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
