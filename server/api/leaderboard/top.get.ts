/** GET /api/leaderboard/top — returns the current top-3 leaderboard entries. */
export default defineEventHandler(async () => {
  const entries = await getTopEntries()
  return { entries }
})
