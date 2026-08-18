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

  it('starts at a random position within bounds when no initialCenter is given', () => {
    // Deterministic per seed (drawn from the same seeded rng as everything
    // else) so the client and the server's replay agree on it without it
    // needing to be transmitted — but not pinned to any fixed spot.
    const a = createEvasionEngine({ seed: 1, bounds })
    const b = createEvasionEngine({ seed: 1, bounds })
    expect(a.getCenter()).toEqual(b.getCenter())

    const start = a.getCenter()
    expect(start.x).toBeGreaterThanOrEqual(0)
    expect(start.x).toBeLessThan(bounds.width)
    expect(start.y).toBeGreaterThanOrEqual(0)
    expect(start.y).toBeLessThan(bounds.height)

    const differentSeed = createEvasionEngine({ seed: 2, bounds })
    expect(differentSeed.getCenter()).not.toEqual(start)
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
      engine.step({ x: 0, y: 0 }) // far corner, well outside the trigger radius
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

  it('moves by a distance within [dodgeMinDistFrac, dodgeMaxDistFrac] * min(bounds) on a dodge', () => {
    // bounds is 400x300, so the 300 min dimension makes the expected
    // absolute range [0.2, 0.3] * 300 = [60, 90].
    const engine = createEvasionEngine({
      seed: 3,
      bounds,
      config: {
        reactionDelayTicks: 0,
        cooldownTicks: 0,
        dodgeMinDistFrac: 0.2,
        dodgeMaxDistFrac: 0.3,
      },
    })
    const before = engine.getCenter()
    engine.step({ x: before.x + 5, y: before.y })
    const after = engine.getCenter()
    const dist = Math.hypot(after.x - before.x, after.y - before.y)
    expect(dist).toBeGreaterThanOrEqual(60 - 1e-9)
    expect(dist).toBeLessThanOrEqual(90 + 1e-9)
  })

  it('moves getRawCenter() by the true dodge distance, unclamped, even past half the bounds', () => {
    // getRawCenter() never wraps, so — unlike getCenter() — it isn't
    // ambiguous about which way a big jump went: useDodgingButton.ts
    // follows it directly for on-screen continuity instead of guessing a
    // wrapped position's shortest path. There's therefore no need to cap
    // dodge distance at half the bounds the way getCenter() effectively is.
    // bounds is 400x300, so fractions of 4/8 give an absolute range of
    // [1200, 2400] — comfortably past half of either bounds dimension.
    const engine = createEvasionEngine({
      seed: 3,
      bounds,
      config: {
        reactionDelayTicks: 0,
        cooldownTicks: 0,
        dodgeMinDistFrac: 4,
        dodgeMaxDistFrac: 8,
      },
    })
    for (let i = 0; i < 20; i++) {
      const before = engine.getRawCenter()
      engine.step({ x: before.x + 5, y: before.y })
      const after = engine.getRawCenter()
      const dist = Math.hypot(after.x - before.x, after.y - before.y)
      expect(dist).toBeGreaterThanOrEqual(1200 - 1e-9)
      expect(dist).toBeLessThanOrEqual(2400 + 1e-9)
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
      const engine = createEvasionEngine({ seed: 1, bounds, config: { buttonRadiusFrac: 0.12 } })
      const c = engine.getCenter()
      expect(engine.testHit(c.x + 100, c.y)).toBe(false)
    })

    it('hits and relocates the button when the click lands within its radius', () => {
      const engine = createEvasionEngine({ seed: 1, bounds, config: { buttonRadiusFrac: 0.12 } })
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
        config: { buttonRadiusFrac: 0.12 },
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

    it('shrinks the radius by radiusShrinkPerHit on every hit', () => {
      const engine = createEvasionEngine({
        seed: 1,
        bounds,
        config: { buttonRadiusFrac: 0.12, radiusShrinkPerHit: 0.9, minButtonRadiusFrac: 10 / 300 },
      })
      expect(engine.getRadius()).toBeCloseTo(36)
      for (let i = 0; i < 5; i++) {
        const c = engine.getCenter()
        expect(engine.testHit(c.x, c.y)).toBe(true)
      }
      expect(engine.getRadius()).toBeCloseTo(36 * 0.9 ** 5)
    })

    it('floors the radius at minButtonRadiusFrac no matter how many hits land', () => {
      const engine = createEvasionEngine({
        seed: 1,
        bounds,
        config: { buttonRadiusFrac: 0.12, radiusShrinkPerHit: 0.5, minButtonRadiusFrac: 10 / 300 },
      })
      for (let i = 0; i < 20; i++) {
        const c = engine.getCenter()
        engine.testHit(c.x, c.y)
      }
      expect(engine.getRadius()).toBeCloseTo(10)
    })

    it('hit-tests against the current shrunk radius, not the original base radius', () => {
      const engine = createEvasionEngine({
        seed: 1,
        bounds,
        config: { buttonRadiusFrac: 0.12, radiusShrinkPerHit: 0.5, minButtonRadiusFrac: 1 / 300 },
      })
      for (let i = 0; i < 6; i++) {
        const c = engine.getCenter()
        engine.testHit(c.x, c.y)
      }
      // Radius is now 36 * 0.5^6 ≈ 0.56, floored at 1 — a 5px-off click would
      // have landed at the original 36px radius, but not at this one.
      const c = engine.getCenter()
      expect(engine.testHit(c.x + 5, c.y)).toBe(false)
    })

    it('grows dodge distance by dodgeDistGrowthPerHit on every hit', () => {
      // dodgeMinDistFrac === dodgeMaxDistFrac pins distance to a single
      // deterministic value per hit, so only the growth multiplier varies.
      const engine = createEvasionEngine({
        seed: 3,
        bounds,
        config: {
          reactionDelayTicks: 0,
          cooldownTicks: 0,
          dodgeMinDistFrac: 0.2,
          dodgeMaxDistFrac: 0.2,
          dodgeDistGrowthPerHit: 1.5,
          maxDodgeDistMultiplier: 100,
        },
      })

      const firstBefore = engine.getRawCenter()
      engine.testHit(engine.getCenter().x, engine.getCenter().y)
      const firstAfter = engine.getRawCenter()
      const firstDist = Math.hypot(firstAfter.x - firstBefore.x, firstAfter.y - firstBefore.y)

      const secondBefore = engine.getRawCenter()
      engine.testHit(engine.getCenter().x, engine.getCenter().y)
      const secondAfter = engine.getRawCenter()
      const secondDist = Math.hypot(secondAfter.x - secondBefore.x, secondAfter.y - secondBefore.y)

      expect(secondDist).toBeCloseTo(firstDist * 1.5)
    })

    it('caps dodge distance growth at maxDodgeDistMultiplier', () => {
      const engine = createEvasionEngine({
        seed: 3,
        bounds,
        config: {
          reactionDelayTicks: 0,
          cooldownTicks: 0,
          dodgeMinDistFrac: 0.2,
          dodgeMaxDistFrac: 0.2,
          dodgeDistGrowthPerHit: 2,
          maxDodgeDistMultiplier: 4,
        },
      })
      for (let i = 0; i < 10; i++) {
        engine.testHit(engine.getCenter().x, engine.getCenter().y)
      }
      // growth^10 is far past the cap of 4, so this hit's dodge should use
      // the capped multiplier: 0.2 * min(bounds) * 4 = 240.
      const before = engine.getRawCenter()
      engine.testHit(engine.getCenter().x, engine.getCenter().y)
      const after = engine.getRawCenter()
      const dist = Math.hypot(after.x - before.x, after.y - before.y)
      expect(dist).toBeCloseTo(0.2 * Math.min(bounds.width, bounds.height) * 4)
    })
  })

  describe('getDebugInfo', () => {
    it('resolves the *Frac config fractions to absolute pixels for these bounds', () => {
      const engine = createEvasionEngine({
        seed: 1,
        bounds,
        config: {
          buttonRadiusFrac: 0.1,
          triggerRadiusFrac: 0.2,
          dodgeMinDistFrac: 0.3,
          dodgeMaxDistFrac: 0.4,
        },
      })
      const info = engine.getDebugInfo()
      expect(info.tick).toBe(0)
      expect(info.hitCount).toBe(0)
      expect(info.radius).toBeCloseTo(0.1 * 300)
      expect(info.triggerRadius).toBeCloseTo(0.2 * 300)
      expect(info.dodgeDistMin).toBeCloseTo(0.3 * 300)
      expect(info.dodgeDistMax).toBeCloseTo(0.4 * 300)
      expect(info.dodgeDistMultiplier).toBeCloseTo(1)
    })

    it('reflects hits: tick/hitCount advance, radius shrinks, dodge distance grows', () => {
      const engine = createEvasionEngine({
        seed: 1,
        bounds,
        config: { radiusShrinkPerHit: 0.5, dodgeDistGrowthPerHit: 2, maxDodgeDistMultiplier: 100 },
      })
      engine.step(engine.getCenter())
      engine.testHit(engine.getCenter().x, engine.getCenter().y)

      const info = engine.getDebugInfo()
      expect(info.tick).toBe(1)
      expect(info.hitCount).toBe(1)
      expect(info.dodgeDistMultiplier).toBeCloseTo(2)
      expect(info.radius).toBeCloseTo(engine.getRadius())
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
      config: { buttonRadiusFrac: 0.12 },
      initialCenter: { x: 200, y: 150 }, // pin the start so the click coordinates above are meaningful
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

    const initialCenter = { x: 200, y: 150 } // pin the start so the click coordinates above are meaningful
    const inOrder = simulateRound({ samples, hits: [hitA, hitB], bounds, seed: 5, initialCenter })
    const shuffled = simulateRound({ samples, hits: [hitB, hitA], bounds, seed: 5, initialCenter })

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
