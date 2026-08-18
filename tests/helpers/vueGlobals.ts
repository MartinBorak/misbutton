import { vi } from 'vitest'
import { ref } from 'vue'

// app/composables/*.ts rely on Nuxt's auto-imported Vue/browser globals
// (ref, onUnmounted, window, ...) instead of explicit imports. Outside the
// Nuxt build these names don't exist, so tests that exercise those files
// stub the minimal surface actually used.

/** ref works standalone with no component instance; onUnmounted needs one, so it's a no-op here — tests call stop() themselves instead of relying on unmount. */
export function stubVueLifecycle() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('onUnmounted', () => {})
}

type Listener = (event: unknown) => void

export interface FakeWindow {
  addEventListener(type: string, listener: Listener): void
  removeEventListener(type: string, listener: Listener): void
  dispatch(type: string, event: unknown): void
  innerWidth: number
  innerHeight: number
}

/** A minimal window stand-in: just enough addEventListener/removeEventListener for pointermove, plus dimensions. */
export function stubWindow(innerWidth = 1024, innerHeight = 768): FakeWindow {
  const listeners = new Map<string, Set<Listener>>()
  const fakeWindow: FakeWindow = {
    innerWidth,
    innerHeight,
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set())
      }
      listeners.get(type)!.add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event)
      }
    },
  }
  vi.stubGlobal('window', fakeWindow)
  return fakeWindow
}

/** Runs the callback synchronously instead of on the next frame, so tests don't need to await real frames. */
export function stubRequestAnimationFrame() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
}

/** Node has a minimal global `navigator` itself; this pins `.webdriver` so tests don't depend on runtime incidentals. */
export function stubNavigator(webdriver = false) {
  vi.stubGlobal('navigator', { webdriver })
}

/** Stubs Nuxt's ofetch-based $fetch global with a plain mock the test configures per call. */
export function stubFetch() {
  const fn = vi.fn()
  vi.stubGlobal('$fetch', fn)
  return fn
}
