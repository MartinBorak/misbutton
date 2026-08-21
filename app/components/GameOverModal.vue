<script setup lang="ts">
  import { ROUND_MS } from '#shared/roundConfig'

  defineProps<{ show: boolean; clicks: number }>()
  defineEmits<{ 'play-again': [] }>()

  const roundSeconds = ROUND_MS / 1000
</script>

<template>
  <Transition name="modal-fade">
    <div
      v-if="show"
      class="modal-backdrop"
    >
      <div class="modal-card">
        <h2>Time's up!</h2>

        <p>You landed {{ clicks }} clicks in {{ roundSeconds }} seconds.</p>

        <div class="modal-card__actions">
          <button
            class="btn btn--primary"
            type="button"
            @click="$emit('play-again')"
          >
            Play again
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
