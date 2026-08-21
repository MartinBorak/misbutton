export interface LeaderboardEntry {
  name: string
  clicks: number
  achievedAt: number
}

/** How many entries count as "the leaderboard" — shown in LeaderboardPanel.vue and enforced in leaderboardStore.ts. */
export const TOP_N = 3
