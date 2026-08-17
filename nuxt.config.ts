import { randomBytes } from 'node:crypto'

// Falls back to a secret generated once per server process if NUXT_ROUND_SECRET
// isn't set. Fine for a single dev/preview instance; set the env var for any
// deployment running more than one server process, so tokens issued by one
// instance verify on another.
const fallbackRoundSecret = randomBytes(32).toString('hex')

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

  css: ['~/assets/css/main.css'],

  routeRules: {
    '/': { prerender: true },
  },

  runtimeConfig: {
    roundSecret: process.env.NUXT_ROUND_SECRET || fallbackRoundSecret,
  },

  nitro: {
    storage: {
      leaderboard: { driver: 'fs', base: '.data/leaderboard' },
      rounds: { driver: 'fs', base: '.data/rounds' },
    },
  },

  app: {
    head: {
      script: [{ innerHTML: themeInitScript, type: 'text/javascript' }],
    },
  },
})
