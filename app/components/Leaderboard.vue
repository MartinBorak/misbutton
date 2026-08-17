<template>
  <div class="leaderboard">
    <p class="leaderboard__title">Top 3</p>
    <ol v-if="entries.length" class="leaderboard__list">
      <li v-for="(entry, i) in entries" :key="`${entry.name}-${entry.achievedAt}`" class="leaderboard__row">
        <span class="leaderboard__rank">{{ i + 1 }}</span>
        <span class="leaderboard__name">{{ entry.name }}</span>
        <span class="leaderboard__clicks">{{ entry.clicks }}</span>
      </li>
    </ol>
    <p v-else class="leaderboard__empty">No scores yet — be the first.</p>
  </div>
</template>

<script setup lang="ts">
import type { LeaderboardEntry } from '~/composables/useLeaderboard'

defineProps<{ entries: LeaderboardEntry[] }>()
</script>
