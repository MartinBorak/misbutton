// The idle button and the in-game dodge button are separate DOM elements
// (index.vue's resting circle vs. DodgeButton.vue's copies), each running
// the same `idle-pulse` CSS animation independently. Left alone, every
// mount restarts that animation at 0%, which is visible as the glow
// snapping back whenever one swaps in for the other — most noticeably right
// when a round starts. Every caller instead phases itself against one
// shared clock (captured once, by whichever of them mounts first), so a
// fresh mount picks up the glow exactly where the previous element's would
// be, however negative CSS animation-delay works for.
let epoch: number | null = null

export function usePulseSync(periodMs: number) {
  const delay = ref('0ms')
  onMounted(() => {
    epoch ??= performance.now()
    delay.value = `${-((performance.now() - epoch) % periodMs)}ms`
  })
  return delay
}
