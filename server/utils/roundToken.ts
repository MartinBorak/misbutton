import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'

export interface RoundPayload {
  roundId: string
  startedAt: number
  seed: number
  w: number
  h: number
  /** Self-reported navigator.webdriver at round start — soft signal only, see round/claim.post.ts. */
  bot: boolean
}

function sign(json: string, secret: string): string {
  return createHmac('sha256', secret).update(json).digest('base64url')
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) {
    return false
  }
  return timingSafeEqual(ab, bb)
}

export function issueRoundToken(bounds: { width: number; height: number }, bot: boolean) {
  const secret = useRuntimeConfig().roundSecret
  const roundId = randomUUID()
  const startedAt = Date.now()
  const seed = randomInt(0, 2 ** 31)
  const payload: RoundPayload = { roundId, startedAt, seed, w: bounds.width, h: bounds.height, bot }
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const token = `${json}.${sign(json, secret)}`
  return { roundId, token, seed, startedAt }
}

export function verifyRoundToken(token: string): RoundPayload | null {
  if (typeof token !== 'string') {
    return null
  }
  const [json, sig] = token.split('.')
  if (!json || !sig) {
    return null
  }
  const secret = useRuntimeConfig().roundSecret
  if (!timingSafeEqualStr(sig, sign(json, secret))) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'))
    if (
      typeof payload?.roundId !== 'string' ||
      typeof payload?.startedAt !== 'number' ||
      typeof payload?.seed !== 'number' ||
      typeof payload?.w !== 'number' ||
      typeof payload?.h !== 'number'
    ) {
      return null
    }
    return payload as RoundPayload
  } catch {
    return null
  }
}
