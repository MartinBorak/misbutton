import { describe, expect, it } from 'vitest'

import { ROUND_MS } from '~~/shared/roundConfig'

describe('ROUND_MS', () => {
  it('is a positive number of milliseconds', () => {
    expect(typeof ROUND_MS).toBe('number')
    expect(ROUND_MS).toBeGreaterThan(0)
  })

  it('resolves to one of the two known round lengths', () => {
    // import.meta.dev is a Nuxt build-time macro (injected by Vite/Nitro's
    // `define`) — under plain vitest it's undefined, so this always
    // resolves to the prod (60s) branch here, not the 5s dev branch. This
    // just pins both known values so an accidental edit to either is caught.
    expect([5_000, 60_000]).toContain(ROUND_MS)
  })
})
