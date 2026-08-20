import { loadOrCreateFallbackRoundSecret } from './config/roundSecret'
import { resolveNitroStorage } from './config/storage'

const fallbackRoundSecret = loadOrCreateFallbackRoundSecret()

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/eslint',
    '@nuxtjs/color-mode',
    '@vercel/analytics/nuxt',
    '@vercel/speed-insights/nuxt',
  ],

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

  colorMode: {
    preference: 'system',
    fallback: 'light',
    storageKey: 'theme',
    dataValue: 'theme',
  },

  app: {
    head: {
      title: 'Misbutton',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
