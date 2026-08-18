<script setup lang="ts">
  import type { EngineDebugInfo } from '#shared/evasionEngine'

  defineProps<{ info: EngineDebugInfo | null }>()
</script>

<template>
  <dl
    v-if="info"
    class="dev-params"
  >
    <div class="dev-params__row">
      <dt>tick</dt>

      <dd>{{ info.tick }}</dd>
    </div>

    <div class="dev-params__row">
      <dt>hits</dt>

      <dd>{{ info.hitCount }}</dd>
    </div>

    <div class="dev-params__row">
      <dt>radius</dt>

      <dd>{{ info.radius.toFixed(1) }}px</dd>
    </div>

    <div class="dev-params__row">
      <dt>trigger radius</dt>

      <dd>{{ info.triggerRadius.toFixed(1) }}px</dd>
    </div>

    <div class="dev-params__row">
      <dt>dodge dist</dt>

      <dd>{{ info.dodgeDistMin.toFixed(0) }}–{{ info.dodgeDistMax.toFixed(0) }}px</dd>
    </div>

    <div class="dev-params__row">
      <dt>dist ×</dt>

      <dd>{{ info.dodgeDistMultiplier.toFixed(2) }}</dd>
    </div>
  </dl>
</template>
