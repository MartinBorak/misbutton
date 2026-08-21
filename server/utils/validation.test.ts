import { describe, expect, it } from 'vitest'

import { sanitizeName } from './validation'

describe('sanitizeName', () => {
  it('rejects non-string input', () => {
    expect(sanitizeName(undefined)).toBeNull()
    expect(sanitizeName(null)).toBeNull()
    expect(sanitizeName(42)).toBeNull()
    expect(sanitizeName({})).toBeNull()
  })

  it('rejects empty or whitespace-only names', () => {
    expect(sanitizeName('')).toBeNull()
    expect(sanitizeName('   ')).toBeNull()
    expect(sanitizeName('\t\n')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeName('  Martin  ')).toBe('Martin')
  })

  it('strips control characters, including embedded ones', () => {
    expect(sanitizeName('Mar\x00tin')).toBe('Martin')
    expect(sanitizeName('Martin\x7F')).toBe('Martin')
    expect(sanitizeName('\x1Bhack')).toBe('hack')
  })

  it('truncates to the max name length', () => {
    const result = sanitizeName('a'.repeat(50))
    expect(result).toHaveLength(16)
  })

  it('leaves ordinary unicode names intact', () => {
    expect(sanitizeName('José 🎮')).toBe('José 🎮')
  })
})
