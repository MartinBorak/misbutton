interface ClaimBody {
  roundId?: string
  token?: string
  name?: string
}

/** POST /api/round/claim — records a qualifying round's player name on the leaderboard. */
export default defineEventHandler(async (event) => {
  const body = await readBody<ClaimBody>(event).catch(() => ({}) as ClaimBody)

  if (!body.roundId || !body.token) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed claim.' })
  }

  const payload = verifyRoundToken(body.token)
  if (!payload || payload.roundId !== body.roundId) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid round token.' })
  }

  if (payload.bot) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Automated sessions are not eligible for the leaderboard.',
    })
  }

  const result = await getRoundResult(payload.roundId)
  if (!result) {
    throw createError({ statusCode: 400, statusMessage: 'Submit the round before claiming.' })
  }
  if (result.claimed) {
    throw createError({ statusCode: 409, statusMessage: 'Round already claimed.' })
  }

  const name = sanitizeName(body.name)
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Name required.' })
  }

  const { qualifies, rank } = await submitEntry({
    name,
    clicks: result.clicks,
    achievedAt: Date.now(),
  })
  await markRoundClaimed(payload.roundId)

  return { qualifies, rank }
})
