import type { Bounds, Vec2 } from '#shared/evasionEngine'

/**
 * Where the arena sits in the viewport, and how big it is. The arena is the
 * play area proper — inset from the viewport by the HUD band above and the
 * footer band below (see main.css), and not to be confused with the
 * full-viewport `.play-field` that contains it.
 *
 * The two therefore don't coincide: everything the engine does happens in
 * arena-local coordinates, while pointer events arrive in viewport ones.
 */
export interface ArenaGeometry {
  /** Viewport coordinates of the arena's top-left corner — subtract to convert a clientX/clientY into arena space. */
  origin: Vec2
  /** The arena's own size, which is what a round's bounds are. */
  bounds: Bounds
}

/**
 * Measures the arena element. Falls back to the whole viewport when there's
 * no element yet (SSR, or before mount) — the same geometry the game had
 * before the arena was inset, so the fallback is a working game rather than
 * a broken one.
 */
export function measureArena(element: HTMLElement | null | undefined): ArenaGeometry {
  if (!element) {
    return {
      origin: { x: 0, y: 0 },
      bounds: { width: window.innerWidth, height: window.innerHeight },
    }
  }
  const { left, top, width, height } = element.getBoundingClientRect()
  return { origin: { x: left, y: top }, bounds: { width, height } }
}
