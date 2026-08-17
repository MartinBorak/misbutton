<template>
  <button
    class="dodge-button"
    :class="{ 'is-hit': isHit }"
    :style="{ '--x': `${x}px`, '--y': `${y}px` }"
    type="button"
    aria-label="Catch me!"
    @pointerdown.prevent="$emit('pointerdown', $event)"
  />
</template>

<script setup lang="ts">
defineProps<{ x: number; y: number; isHit: boolean }>()
defineEmits<{ pointerdown: [e: PointerEvent] }>()
</script>
