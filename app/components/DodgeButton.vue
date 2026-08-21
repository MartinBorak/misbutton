<script setup lang="ts">
  const props = defineProps<{
    x: number
    y: number
    /**
     * Ids of the hit-ring ripples currently animating (see
     *  useDodgingButton.ts) — rendered as one overlay per id so a hit in the
     *  second half of an existing ripple can overlap it instead of
     * restarting it.
     */
    ripples: number[]
    bounds: { width: number; height: number }
    /**
     * Current hit-radius from the engine (shrinks with each click, see
     *  shared/evasionEngine.ts) — drives both the windowing math below and
     * the rendered size, so what's drawn always matches what's clickable.
     */
    radius: number
  }>()
  defineEmits<{ pointerdown: [e: PointerEvent] }>()

  const pulseDelay = usePulseSync()

  /**
   * The play field wraps (see shared/evasionEngine.ts), and x/y are kept
   * continuous with the button's on-screen trajectory rather than snapped to
   * the engine's internally-wrapped position — otherwise a dodge through one
   * edge would jump to some unrelated point instead of sliding off-screen.
   * That means x/y can drift arbitrarily far from the visible [0, bounds)
   * range over a round (e.g. repeatedly cornering it against the same edge
   * wraps it further each time), so the grid of rendered copies is centered
   * on however far it's *currently* drifted (k0x/k0y below), not a fixed
   * window around 0 — otherwise the on-screen copy can end up outside the
   * window and the button vanishes entirely.
   *
   * Keying each copy by its actual offset (not array index) is what makes
   * this safe: when the window shifts by one step, the two cells that
   * stay in range keep their DOM identity and keep transitioning smoothly
   * off/into view, while the cell that falls out of range unmounts (it was
   * off-screen already) and any newly-in-range cell mounts fresh (also
   * off-screen at first, so appearing without a transition is unnoticeable).
   */
  function centerStep(pos: number, size: number): number {
    const canonical = ((pos % size) + size) % size
    return Math.round((canonical - pos) / size)
  }

  /**
   * The 3x3 grid of wrapped copies to render around the button's current
   * drifted position, so a dodge through an edge slides continuously into
   * view instead of jumping.
   */
  const copies = computed(() => {
    const { width, height } = props.bounds
    if (!width || !height) {
      return [{ key: '0,0', x: props.x, y: props.y, visible: true }]
    }
    const k0x = centerStep(props.x, width)
    const k0y = centerStep(props.y, height)
    const result: { key: string; x: number; y: number; visible: boolean }[] = []
    for (const ky of [k0y - 1, k0y, k0y + 1]) {
      for (const kx of [k0x - 1, k0x, k0x + 1]) {
        const cx = props.x + kx * width
        const cy = props.y + ky * height
        const visible =
          cx + props.radius > 0 &&
          cx - props.radius < width &&
          cy + props.radius > 0 &&
          cy - props.radius < height
        result.push({ key: `${kx},${ky}`, x: cx, y: cy, visible })
      }
    }
    return result
  })
</script>

<template>
  <div class="dodge-button-group">
    <button
      v-for="c in copies"
      :key="c.key"
      class="dodge-button"
      :style="{
        '--x': `${c.x}px`,
        '--y': `${c.y}px`,
        '--button-diameter': `${radius * 2}px`,
        '--idle-pulse-duration': `${IDLE_PULSE_PERIOD_MS}ms`,
        '--ripple-duration': `${RIPPLE_DURATION_MS}ms`,
        'animation-delay': pulseDelay,
      }"
      type="button"
      :aria-label="c.visible ? 'Catch me!' : undefined"
      :aria-hidden="c.visible ? undefined : true"
      :tabindex="c.visible ? undefined : -1"
      @pointerdown.prevent="$emit('pointerdown', $event)"
    >
      <span
        v-for="r in ripples"
        :key="r"
        class="dodge-button__ripple"
      />
    </button>
  </div>
</template>
