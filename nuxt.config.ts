import { loadOrCreateFallbackRoundSecret } from './config/roundSecret'
import { resolveNitroStorage } from './config/storage'

const fallbackRoundSecret = loadOrCreateFallbackRoundSecret()

/**
 * Canonical production origin. Used for og:url and rel=canonical (so Vercel's
 * preview deployments can't be indexed as duplicates of the real site), and to
 * make og:image absolute — most link scrapers won't resolve a relative one.
 */
const SITE_URL = 'https://misbutton.vercel.app'

/**
 * Shown in search results and, more to the point, in the link preview cards
 * that Discord/Slack/X/iMessage unfurl — which is how a game like this
 * actually spreads. Kept under ~155 characters so it isn't truncated.
 */
const SITE_DESCRIPTION =
  "A button that really doesn't want to be clicked. You get 60 seconds — it sees your cursor coming and dodges. How many times can you catch it?"

/**
 * Bump whenever public/og.png is regenerated. Scrapers cache preview images
 * by URL and won't re-fetch one they've already unfurled, so replacing the
 * file in place leaves every link already shared to Discord/Slack/X showing
 * the old screenshot — for as long as their caches hold it. Versioning the
 * URL is what makes it a fetch they haven't done before.
 */
const OG_IMAGE_VERSION = 2

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
      /* Lets screen readers pick the right pronunciation, and is a search signal. */
      htmlAttrs: { lang: 'en' },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'canonical', href: SITE_URL },
      ],
      meta: [
        { name: 'description', content: SITE_DESCRIPTION },
        /* Twitter falls back to the og: values, so only the card type is needed. */
        { name: 'twitter:card', content: 'summary_large_image' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Misbutton' },
        { property: 'og:title', content: 'Misbutton' },
        { property: 'og:description', content: SITE_DESCRIPTION },
        { property: 'og:url', content: SITE_URL },
        { property: 'og:image', content: `${SITE_URL}/og.png?v=${OG_IMAGE_VERSION}` },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        {
          property: 'og:image:alt',
          content: 'The Misbutton start screen: a glowing button waiting to be caught',
        },
      ],
    },
  },
})
