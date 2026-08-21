/** GET /api/leaderboard/top — returns the current top-N leaderboard entries (see TOP_N). */
export default defineEventHandler(async () => {
  const entries = await getTopEntries()
  return { entries }
})
