import { describe, expect, it } from 'vitest'

import {
  createEvasionEngine,
  createRng,
  simulateRound,
  wrappedDelta,
  type Vec2,
} from './evasionEngine'

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a()).not.toBe(b())
  })

  it('produces values in [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 200; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('wrappedDelta', () => {
  it('returns the value unchanged when already within half the size', () => {
    expect(wrappedDelta(10, 100)).toBe(10)
    expect(wrappedDelta(-10, 100)).toBe(-10)
    expect(wrappedDelta(0, 100)).toBe(0)
  })

  it('wraps a value past the positive half to its negative equivalent', () => {
    // 70 on a size-100 dimension is "closer" going the other way (-30).
    expect(wrappedDelta(70, 100)).toBe(-30)
  })

  it('wraps a value past the negative half to its positive equivalent', () => {
    expect(wrappedDelta(-70, 100)).toBe(30)
  })

  it('handles magnitudes larger than one full size', () => {
    expect(wrappedDelta(1090, 100)).toBe(-10) // 1090 mod 100 = -10 shortest path
    expect(wrappedDelta(-1090, 100)).toBe(10)
  })
})

describe('createEvasionEngine', () => {
  const bounds = { width: 400, height: 300 }

  it('starts centered in the bounds when no initialCenter is given', () => {
    const engine = createEvasionEngine({ seed: 1, bounds })
    expect(engine.getCenter()).toEqual({ x: 200, y: 150 })
  })

  it('honors an explicit initialCenter', () => {
    const engine = createEvasionEngine({ seed: 1, bounds, initialCenter: { x: 10, y: 20 } })
    expect(engine.getCenter()).toEqual({ x: 10, y: 20 })
  })

  it('increments the tick counter on every step', () => {
    const engine = createEvasionEngine({ seed: 1, bounds })
    expect(engine.getTick()).toBe(0)
    engine.step({ x: 200, y: 150 })
    engine.step({ x: 200, y: 150 })
    expect(engine.getTick()).toBe(2)
  })

  it('does not move when the cursor stays outside the trigger radius', () => {
    const engine = createEvasionEngine({ seed: 1, bounds })
    const start = engine.getCenter()
    for (let i = 0; i < 20; i++) {
      engine.step({ x: 0, y: 0 }) // far corner, well outside triggerRadius (90)
    }
    expect(engine.getCenter()).toEqual(start)
  })

  it('dodges only after reactionDelayTicks of sustained proximity, not on the first close tick', () => {
    const engine = createEvasionEngine({
      seed: 1,
      bounds,
      config: { reactionDelayTicks: 3, cooldownTicks: 0 },
    })
    const start = engine.getCenter()
    const cursor = { x: start.x + 5, y: start.y } // well within triggerRadius

    engine.step(cursor) // tick 0 -> arms pendingReadyAtTick = 3
    expect(engine.getCenter()).toEqual(start)
    engine.step(cursor) // tick 1
    expect(engine.getCenter()).toEqual(start)
    engine.step(cursor) // tick 2
    expect(engine.getCenter()).toEqual(start)
    engine.step(cursor) // tick 3 -> fires
    expect(engine.getCenter()).not.toEqual(start)
  })

  it('does not dodge again until cooldownTicks have passed since the last dodge', () => {
    const engine = createEvasionEngine({
      seed: 1,
      bounds,
      config: { reactionDelayTicks: 0, cooldownTicks: 5 },
    })
    const start = engine.getCenter()
    engine.step({ x: start.x + 5, y: start.y }) // fires immediately (reactionDelayTicks 0)
    const afterFirstDodge = engine.getCenter()
    expect(afterFirstDodge).not.toEqual(start)

    // Keep the cursor glued to the new center — still within cooldown, must not move again.
    for (let i = 0; i < 4; i++) {
      const c = engine.getCenter()
      engine.step({ x: c.x, y: c.y })
    }
    expect(engine.getCenter()).toEqual(afterFirstDodge)
  })

  it('moves by a distance within [dodgeMinDist, dodgeMaxDist] on a dodge', () => {
    const engine = createEvasionEngine({
      seed: 3,
      bounds,
      config: { reactionDelayTicks: 0, cooldownTicks: 0, dodgeMinDist: 50, dodgeMaxDist: 80 },
    })
    const before = engine.getCenter()
    engine.step({ x: before.x + 5, y: before.y })
    const after = engine.getCenter()
    const dist = Math.hypot(after.x - before.x, after.y - before.y)
    expect(dist).toBeGreaterThanOrEqual(50 - 1e-9)
    expect(dist).toBeLessThanOrEqual(80 + 1e-9)
  })

  it('caps dodge distance at half the smaller bounds dimension, even if config asks for more', () => {
    // A dodge longer than half a wrapping dimension is ambiguous once
    // wrapped: useDodgingButton.ts reconstructs a continuous on-screen
    // position from the shortest path between ticks, so an overlong jump
    // would be indistinguishable from a much shorter jump the other way.
    const engine = createEvasionEngine({
      seed: 3,
      bounds,
      config: { reactionDelayTicks: 0, cooldownTicks: 0, dodgeMinDist: 1000, dodgeMaxDist: 2000 },
    })
    const maxSafeDist = Math.min(bounds.width, bounds.height) / 2
    for (let i = 0; i < 20; i++) {
      const before = engine.getCenter()
      const after = engine.step({ x: before.x + 5, y: before.y })
      const dx = wrappedDelta(after.x - before.x, bounds.width)
      const dy = wrappedDelta(after.y - before.y, bounds.height)
      const dist = Math.hypot(dx, dy)
      expect(dist).toBeLessThanOrEqual(maxSafeDist + 1e-9)
    }
  })

  it('never leaves [0, bounds) even under relentless one-directional chasing', () => {
    const engine = createEvasionEngine({ seed: 9, bounds })
    for (let i = 0; i < 3000; i++) {
      const c = engine.getCenter()
      const next = engine.step({ x: c.x + 5, y: c.y })
      expect(next.x).toBeGreaterThanOrEqual(0)
      expect(next.x).toBeLessThan(bounds.width)
      expect(next.y).toBeGreaterThanOrEqual(0)
      expect(next.y).toBeLessThan(bounds.height)
    }
  })

  it('triggers evasion via proximity across the wrap seam, not just raw straight-line distance', () => {
    // Button sits right at the edge; a cursor just past the *other* edge is
    // actually adjacent to it through the wrap, even though the raw
    // straight-line distance across the field is huge.
    const engine = createEvasionEngine({
      seed: 1,
      bounds,
      initialCenter: { x: 395, y: 150 },
      config: { reactionDelayTicks: 0, cooldownTicks: 0 },
    })
    const before = engine.getCenter()
    engine.step({ x: 5, y: 150 }) // 10px away through the seam, ~390px away in a straight line
    expect(engine.getCenter()).not.toEqual(before)
  })

  describe('testHit', () => {
    it('misses when the click is outside the button radius', () => {
      const engine = createEvasionEngine({ seed: 1, bounds, config: { buttonRadius: 36 } })
      const c = engine.getCenter()
      expect(engine.testHit(c.x + 100, c.y)).toBe(false)
    })

    it('hits and relocates the button when the click lands within its radius', () => {
      const engine = createEvasionEngine({ seed: 1, bounds, config: { buttonRadius: 36 } })
      const c = engine.getCenter()
      const hit = engine.testHit(c.x + 5, c.y)
      expect(hit).toBe(true)
      expect(engine.getCenter()).not.toEqual(c)
    })

    it('hits across the wrap seam: a click just past one edge hits a button just past the other', () => {
      const engine = createEvasionEngine({
        seed: 1,
        bounds,
        initialCenter: { x: 397, y: 150 },
        config: { buttonRadius: 36 },
      })
      // Straight-line distance from (3, 150) to (397, 150) is 394px — way
      // outside any reasonable radius — but the wrapped distance is 6px.
      expect(engine.testHit(3, 150)).toBe(true)
    })

    it('resets the cooldown so a hit can immediately be followed by an approach-triggered dodge window', () => {
      const engine = createEvasionEngine({
        seed: 1,
        bounds,
        config: { reactionDelayTicks: 1, cooldownTicks: 0 },
      })
      const c0 = engine.getCenter()
      engine.testHit(c0.x, c0.y)
      const c1 = engine.getCenter()
      expect(c1).not.toEqual(c0)
      // cooldownTicks is 0, so proximity right after a hit can still arm a new dodge.
      engine.step({ x: c1.x + 5, y: c1.y })
      engine.step({ x: c1.x + 5, y: c1.y })
      expect(engine.getCenter()).not.toEqual(c1)
    })
  })
})

describe('simulateRound', () => {
  const bounds = { width: 400, height: 300 }

  it('is deterministic for identical inputs', () => {
    const samples: Vec2[] = Array.from({ length: 20 }, (_, i) => ({ x: 200 + i, y: 150 }))
    const params = { samples, hits: [{ tick: 5, x: 200, y: 150 }], bounds, seed: 42 }
    expect(simulateRound(params)).toEqual(simulateRound(params))
  })

  it('counts a hit that lands on the button and does not count a miss', () => {
    const samples: Vec2[] = Array.from({ length: 5 }, () => ({ x: 0, y: 0 })) // cursor never near the button
    const result = simulateRound({
      samples,
      hits: [
        { tick: 0, x: 200, y: 150 }, // dead center at t=0 -> hit
        { tick: 1, x: 0, y: 0 }, // far away -> miss
      ],
      bounds,
      seed: 1,
    })
    expect(result.hitResults).toEqual([true, false])
    expect(result.clicks).toBe(1)
  })

  it('resolves hits in tick order regardless of input array order', () => {
    // hitResults is indexed by each hit's position in the *input* array, so
    // shuffling the input legitimately shuffles which slot holds which
    // result — what must stay invariant is the outcome *per hit event* and
    // the resulting button position, not the raw array order.
    const samples: Vec2[] = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }))
    const hitA = { tick: 0, x: 200, y: 150 }
    const hitB = { tick: 2, x: 0, y: 0 }

    const inOrder = simulateRound({ samples, hits: [hitA, hitB], bounds, seed: 5 })
    const shuffled = simulateRound({ samples, hits: [hitB, hitA], bounds, seed: 5 })

    expect(inOrder.hitResults).toEqual([true, false]) // hitA hits, hitB misses
    expect(shuffled.hitResults).toEqual([false, true]) // same outcomes, slots swapped
    expect(shuffled.finalCenter).toEqual(inOrder.finalCenter)
  })

  it('returns a finalCenter that stays within bounds', () => {
    const samples: Vec2[] = Array.from({ length: 500 }, (_, i) => ({
      x: 200 + Math.sin(i / 5) * 300,
      y: 150 + Math.cos(i / 5) * 300,
    }))
    const result = simulateRound({ samples, hits: [], bounds, seed: 11 })
    expect(result.finalCenter.x).toBeGreaterThanOrEqual(0)
    expect(result.finalCenter.x).toBeLessThan(bounds.width)
    expect(result.finalCenter.y).toBeGreaterThanOrEqual(0)
    expect(result.finalCenter.y).toBeLessThan(bounds.height)
  })
})
