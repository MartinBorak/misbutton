import { loadOrCreateFallbackRoundSecret } from './config/roundSecret'
import { resolveNitroStorage } from './config/storage'

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
    storage: resolveNitroStorage(),
  },

  app: {
    head: {
      title: 'Misbutton',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [{ innerHTML: themeInitScript, type: 'text/javascript' }],
    },
  },
})
