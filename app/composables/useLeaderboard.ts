import type { LeaderboardEntry } from '#shared/leaderboard'

export function useLeaderboard() {
  const entries = ref<LeaderboardEntry[]>([])
  const loading = ref(false)

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
