import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Falls back to a secret persisted in .data/ if NUXT_ROUND_SECRET isn't set,
// so it survives Nitro dev-server reloads (which re-evaluate nuxt.config.ts)
// — otherwise a round's token would stop verifying if a reload lands between
// its start and submit requests. Fine for a single dev/preview instance; set
// the env var for any deployment running more than one server process, so
// tokens issued by one instance verify on another.
export function loadOrCreateFallbackRoundSecret(): string {
  const path = join(fileURLToPath(new URL('..', import.meta.url)), '.data', 'round-secret')
  if (existsSync(path)) {
    return readFileSync(path, 'utf8').trim()
  }
  const secret = randomBytes(32).toString('hex')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, secret)
  return secret
}
