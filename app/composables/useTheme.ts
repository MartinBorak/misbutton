const ColorTheme = {
  LIGHT: 'light',
  DARK: 'dark',
} as const

export type Theme = (typeof ColorTheme)[keyof typeof ColorTheme]

/**
 * colorMode.value is typed as a plain string (the module allows custom
 * modes beyond dark/light), so map it down to the theme values this app uses.
 */
const THEME_BY_COLOR_MODE: Record<string, Theme> = {
  [ColorTheme.LIGHT]: ColorTheme.LIGHT,
  [ColorTheme.DARK]: ColorTheme.DARK,
}

/**
 * The pre-paint decision (localStorage / prefers-color-scheme) and the
 * data-theme attribute are both handled by @nuxtjs/color-mode.
 */
export function useTheme() {
  const colorMode = useColorMode()

  const theme = computed(() => THEME_BY_COLOR_MODE[colorMode.value] ?? ColorTheme.LIGHT)

  /** Flips between light and dark. */
  function toggle() {
    colorMode.preference = theme.value === ColorTheme.DARK ? ColorTheme.LIGHT : ColorTheme.DARK
  }

  return { theme, toggle }
}
