<template>
  <Transition name="modal-fade">
    <div v-if="show" class="modal-backdrop">
      <div class="modal-card">
        <h2>Top {{ rank }}!</h2>
        <p>{{ clicks }} clicks — enter a name for the leaderboard.</p>
        <input
          v-model="name"
          type="text"
          maxlength="16"
          placeholder="Your name"
          autofocus
          @keyup.enter="submit"
        />
        <div class="modal-card__actions">
          <button class="btn btn--secondary" type="button" @click="$emit('skip')">Skip</button>
          <button class="btn btn--primary" type="button" :disabled="!name.trim()" @click="submit">Save</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
const props = defineProps<{ show: boolean; rank: number; clicks: number }>()
const emit = defineEmits<{ submit: [name: string]; skip: [] }>()

const name = ref('')

watch(
  () => props.show,
  (visible) => {
    if (visible) name.value = ''
  },
)

function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  emit('submit', trimmed)
}
</script>
