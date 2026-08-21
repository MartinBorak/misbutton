export interface LeaderboardEntry {
  name: string
  clicks: number
  achievedAt: number
}

/** How many entries count as "the leaderboard" — shown in LeaderboardPanel.vue and enforced in leaderboardStore.ts. */
export const TOP_N = 3

/**
 * Whether a score made the leaderboard and where. rank is 1-based, or -1
 * when it didn't qualify. Shared because it's both leaderboardStore's return
 * shape and the body the round submit/claim routes answer with.
 */
export interface QualificationResult {
  qualifies: boolean
  rank: number
}
