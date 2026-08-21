export default defineEventHandler(async () => {
  const entries = await getTopEntries()
  return { entries }
})
