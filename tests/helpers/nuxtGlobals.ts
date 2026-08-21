import { vi } from 'vitest'

/**
 * server/utils/*.ts and server/api/**\/*.ts rely on Nitro's auto-imported
 * globals (useRuntimeConfig, useStorage, defineEventHandler, readBody,
 * createError, ...) instead of explicit imports. Outside the Nitro build
 * these names don't exist, so tests that exercise those files stub the
 * minimal surface actually used, in-process, with no real storage I/O.
 */

export interface MemoryStorage {
  getItem<T>(key: string): Promise<T | null>
  setItem<T>(key: string, value: T): Promise<void>
}

export function createMemoryStorage(): MemoryStorage {
  const data = new Map<string, unknown>()
  return {
    async getItem<T>(key: string) {
      return (data.has(key) ? data.get(key) : null) as T | null
    },
    async setItem<T>(key: string, value: T) {
      data.set(key, value)
    },
  }
}

/** Stubs useRuntimeConfig() to return the given roundSecret, as roundToken.ts expects. */
export function stubRuntimeConfig(roundSecret = 'test-secret') {
  vi.stubGlobal('useRuntimeConfig', () => ({ roundSecret }))
}

/**
 * Stubs useStorage(mountName) with an isolated in-memory store per mount
 * name, matching the "rounds" / "leaderboard" mounts configured in
 * nuxt.config.ts. Returns the stores so tests can inspect/seed them directly.
 */
export function stubStorage() {
  const stores = new Map<string, MemoryStorage>()
  vi.stubGlobal('useStorage', (mount: string) => {
    let store = stores.get(mount)
    if (!store) {
      store = createMemoryStorage()
      stores.set(mount, store)
    }
    return store
  })
  return stores
}

/** Stubs defineEventHandler as h3 does for a plain handler: identity. */
export function stubDefineEventHandler() {
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
}

/** Minimal H3Error-shaped stub for createError, sufficient for assertions on statusCode/statusMessage. */
export class TestH3Error extends Error {
  statusCode: number
  statusMessage: string

  constructor(opts: { statusCode: number; statusMessage: string }) {
    super(opts.statusMessage)
    this.statusCode = opts.statusCode
    this.statusMessage = opts.statusMessage
  }
}

export function stubCreateError() {
  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string }) => new TestH3Error(opts),
  )
}

/** Stubs readBody(event) to resolve whatever body the fake event carries. */
export function stubReadBody() {
  vi.stubGlobal('readBody', async (event: { _body: unknown }) => event._body)
}

export function fakeEvent(body: unknown) {
  return { _body: body }
}

/**
 * The minimal Nitro-global surface every server/api/round/*.post.ts test
 * needs stubbed before its handler module is imported (each route also
 * stubs its own route-specific globals — issueRoundToken, wouldQualify,
 * etc. — separately, on top of this).
 */
export function stubServerApiBasics(roundSecret = 'test-secret') {
  stubDefineEventHandler()
  stubReadBody()
  stubCreateError()
  stubRuntimeConfig(roundSecret)
  stubStorage()
}
