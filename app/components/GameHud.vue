<script setup lang="ts">
  import type { LeaderboardEntry } from '~/composables/useLeaderboard'

  const props = defineProps<{
    timeRemainingMs: number
    clicks: number
    theme: 'light' | 'dark'
    entries: LeaderboardEntry[]
    showStats: boolean
  }>()
  defineEmits<{ 'toggle-theme': [] }>()

  const seconds = computed(() => Math.ceil(props.timeRemainingMs / 1000))
  const urgent = computed(() => seconds.value <= 10)
</script>

<template>
  <div class="hud">
    <LeaderboardPanel
      class="hud__leaderboard"
      :entries="entries"
    />

    <div
      v-if="showStats"
      class="hud__stats"
    >
      <div class="hud__stat">
        <span class="hud__stat-label">Time</span>

        <span
          class="hud__stat-value"
          :class="{ 'hud__stat-value--urgent': urgent }"
          >{{ seconds }}</span
        >
      </div>

      <div class="hud__stat">
        <span class="hud__stat-label">Clicks</span>

        <span class="hud__stat-value">{{ clicks }}</span>
      </div>
    </div>

    <button
      class="theme-toggle"
      type="button"
      :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="$emit('toggle-theme')"
    >
      {{ theme === 'dark' ? '☀️' : '🌙' }}
    </button>
  </div>
</template>
