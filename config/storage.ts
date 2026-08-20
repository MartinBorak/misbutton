import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Vercel's "Upstash for Redis" integration injects KV_REST_API_* rather than
 * the UPSTASH_REDIS_REST_* names the unstorage driver defaults to.
 */
export function resolveNitroStorage() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

  if (url && token) {
    return {
      leaderboard: { driver: 'upstash', base: 'leaderboard', url, token },
      /**
       * Round tokens are only valid for ~65s (ROUND_MS ± slop) and rate-limit
       * counters reset after 60s, so nothing here needs to outlive 5 minutes.
       */
      rounds: { driver: 'upstash', base: 'rounds', url, token, ttl: 300 },
    }
  }

  /**
   * fs has no TTL support, so round data (single-round-lifetime by design)
   * just gets wiped fresh at each local dev/build start.
   */
  rmSync(join(projectRoot, '.data', 'rounds'), { recursive: true, force: true })
  return {
    leaderboard: { driver: 'fs', base: '.data/leaderboard' },
    rounds: { driver: 'fs', base: '.data/rounds' },
  }
}
