export default defineEventHandler(async () => {
  const entries = await getTop()
  return { entries }
})
