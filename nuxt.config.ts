import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Falls back to a secret persisted in .data/ if NUXT_ROUND_SECRET isn't set,
// so it survives Nitro dev-server reloads (which re-evaluate this file) —
// otherwise a round's token would stop verifying if a reload lands between
// its start and submit requests. Fine for a single dev/preview instance; set
// the env var for any deployment running more than one server process, so
// tokens issued by one instance verify on another.
function loadOrCreateFallbackRoundSecret(): string {
  const path = join(fileURLToPath(new URL('.', import.meta.url)), '.data', 'round-secret')
  if (existsSync(path)) {
    return readFileSync(path, 'utf8').trim()
  }
  const secret = randomBytes(32).toString('hex')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, secret)
  return secret
}

const fallbackRoundSecret = loadOrCreateFallbackRoundSecret()

const themeInitScript = [
  '(function () {',
  '  try {',
  "    var stored = localStorage.getItem('theme');",
  "    var theme = stored === 'light' || stored === 'dark'",
  '      ? stored',
  "      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');",
  '    document.documentElement.dataset.theme = theme;',
  '  } catch (e) {}',
  '})();',
].join('\n')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxt/eslint', '@vercel/analytics/nuxt', '@vercel/speed-insights/nuxt'],

  css: ['~/assets/css/main.css'],

  routeRules: {
    '/': { prerender: true },
  },

  runtimeConfig: {
    roundSecret: process.env.NUXT_ROUND_SECRET || fallbackRoundSecret,
  },

  nitro: {
    // Vercel's "Upstash for Redis" integration injects KV_REST_API_* rather
    // than the UPSTASH_REDIS_REST_* names the unstorage driver defaults to.
    storage: (() => {
      const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
      const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
      return url && token
        ? {
            leaderboard: { driver: 'upstash', base: 'leaderboard', url, token },
            // Round tokens are only valid for ~65s (ROUND_MS ± slop) and rate-limit
            // counters reset after 60s, so nothing here needs to outlive 5 minutes.
            rounds: { driver: 'upstash', base: 'rounds', url, token, ttl: 300 },
          }
        : (() => {
            // fs has no TTL support, so round data (single-round-lifetime by
            // design) just gets wiped fresh at each local dev/build start.
            rmSync(join(fileURLToPath(new URL('.', import.meta.url)), '.data', 'rounds'), {
              recursive: true,
              force: true,
            })
            return {
              leaderboard: { driver: 'fs', base: '.data/leaderboard' },
              rounds: { driver: 'fs', base: '.data/rounds' },
            }
          })()
    })(),
  },

  app: {
    head: {
      title: 'Misbutton',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [{ innerHTML: themeInitScript, type: 'text/javascript' }],
    },
  },
})
