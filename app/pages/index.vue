<script setup lang="ts">
  const pointerCapable = usePointerCapability()
  const { theme, toggle } = useTheme()
  const leaderboard = useLeaderboard()

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
    dodgeIsHit,
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

  onMounted(() => {
    leaderboard.refresh()
  })
</script>

<template>
  <div class="play-field">
    <UnsupportedDeviceNotice v-if="pointerCapable === false" />

    <template v-else>
      <GameHud
        v-if="phase === 'playing'"
        :time-remaining-ms="timeRemainingMs"
        :clicks="liveClicks"
        :theme="theme"
        @toggle-theme="toggle"
      />

      <button
        v-else
        class="theme-toggle theme-toggle--corner"
        type="button"
        :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="toggle"
      >
        {{ theme === 'dark' ? '☀️' : '🌙' }}
      </button>

      <DodgeButton
        v-if="phase === 'playing'"
        :x="dodgeX"
        :y="dodgeY"
        :is-hit="dodgeIsHit"
        @pointerdown="handlePointerDown"
      />

      <div
        v-if="phase === 'idle'"
        class="idle-card"
      >
        <h1>Catch the button</h1>

        <p>60 seconds. It really doesn't want to be clicked.</p>

        <button
          class="btn btn--primary"
          type="button"
          @click="startRound"
        >
          Play
        </button>
      </div>

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

    <div
      v-if="pointerCapable !== null && phase !== 'playing'"
      class="leaderboard--floating"
    >
      <LeaderboardPanel :entries="leaderboard.entries.value" />
    </div>

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
