// null = not yet determined (first client tick), true/false once resolved.
// Gates gameplay behind a real mouse/trackpad — see UnsupportedDeviceNotice.vue.
export function usePointerCapability() {
  const capable = useState<boolean | null>('pointer-capable', () => null)

  onMounted(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const hover = window.matchMedia('(hover: hover)').matches
    capable.value = fine && hover
  })

  return capable
}
