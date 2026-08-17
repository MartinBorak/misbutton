type Theme = 'light' | 'dark'

// The actual pre-paint decision happens in the inline head script (nuxt.config.ts),
// which already stamped documentElement.dataset.theme before Vue mounted — this
// composable just mirrors that into reactive state and persists explicit toggles.
export function useTheme() {
  const theme = useState<Theme>('theme', () => 'light')

  onMounted(() => {
    theme.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })

  function toggle() {
    const next: Theme = theme.value === 'dark' ? 'light' : 'dark'
    theme.value = next
    document.documentElement.dataset.theme = next
    localStorage.setItem('theme', next)
  }

  return { theme, toggle }
}
