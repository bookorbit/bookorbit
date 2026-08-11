import { describe, expect, it } from 'vitest'

import { checkIdentityText } from '../lib/identity-text'

describe('checkIdentityText', () => {
  it.each(['ada_lovelace', 'José-García', '夏目漱石', 'Кирилл', 'أحمد', 'ada99', 'user.name', 'Ada Lovelace', 'a'])('accepts %s', (value) => {
    expect(checkIdentityText(value)).toBeNull()
  })

  it.each([
    ['a right-to-left override', 'adm\u202Ein'],
    ['a left-to-right override', 'adm\u202Din'],
    ['a right-to-left isolate', 'adm\u2067in'],
    ['a zero-width space', 'ad\u200Bmin'],
    ['a zero-width joiner', 'ad\u200Dmin'],
    ['a byte order mark', 'ad\uFEFFmin'],
    ['a newline', 'evil\nadmin'],
    ['a carriage return', 'evil\radmin'],
    ['a null byte', 'ad\u0000min'],
    ['a delete control character', 'ad\u007Fmin'],
    ['a trailing tab, which is itself a control character', 'admin\t'],
  ])('rejects %s as unsafe', (_label, value) => {
    expect(checkIdentityText(value)).toBe('unsafeCharacters')
  })

  it.each([
    ['leading space', ' admin'],
    ['trailing space', 'admin '],
    ['both', ' admin '],
    ['a leading ideographic space', '　admin'],
  ])('rejects %s as untrimmed', (_label, value) => {
    expect(checkIdentityText(value)).toBe('untrimmed')
  })

  it('rejects an empty string', () => {
    expect(checkIdentityText('')).toBe('unsafeCharacters')
  })
})
