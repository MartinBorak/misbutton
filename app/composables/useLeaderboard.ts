import type { LeaderboardEntry } from '#shared/leaderboard'

/** Holds the top-N leaderboard entries (see TOP_N) and fetches them from the server. */
export function useLeaderboard() {
  const entries = ref<LeaderboardEntry[]>([])
  const loading = ref(false)

  /** Fetches the current top entries from the server. */
  async function refresh() {
    loading.value = true
    try {
      const res = await $fetch<{ entries: LeaderboardEntry[] }>('/api/leaderboard/top')
      entries.value = res.entries
    } catch {
      // transient failure — keep showing whatever we last had
    } finally {
      loading.value = false
    }
  }

  return { entries, loading, refresh }
}
