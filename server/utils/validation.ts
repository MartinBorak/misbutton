import { MAX_NAME_LENGTH } from '#shared/validation'

function isControlCharCode(code: number): boolean {
  return code < 32 || code === 127
}

export function sanitizeName(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }
  const visible = [...input].filter((char) => !isControlCharCode(char.codePointAt(0) || 0)).join('')
  const cleaned = visible.trim().slice(0, MAX_NAME_LENGTH)
  return cleaned || null
}
