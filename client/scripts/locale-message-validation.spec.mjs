import { describe, expect, it } from 'vitest'
import { analyzeIcuMessage, isIcuPluralMessage, validateLocaleMessage, validateSlotCountMessage } from './locale-message-validation.mjs'

const validate = (locale, referenceMessage, message) =>
  validateLocaleMessage({
    key: 'books.count',
    locale,
    message,
    referenceMessage,
  })

describe('locale message validation', () => {
  it('analyzes nested ICU arguments and plural selectors', () => {
    const message = '{count, plural, =0 {No books for {name}} one {One book} other {# books}}'

    expect(isIcuPluralMessage(message)).toBe(true)
    expect(analyzeIcuMessage(message)).toEqual({
      arguments: ['count', 'name'],
      argumentSignatures: ['count:cardinal', 'name:argument'],
      emptyOptions: [],
      plurals: [
        {
          argument: 'count',
          offset: 0,
          type: 'cardinal',
          selectors: ['=0', 'one', 'other'],
        },
      ],
      selects: [],
    })
  })

  it('rejects malformed ordinary Vue I18n messages', () => {
    expect(validate('de', 'Hello, {name}!', 'Hallo, {{name}}!')).toEqual(['de: invalid Vue I18n syntax in books.count: Not allowed nest placeholder'])
  })

  it('rejects legacy plural syntax', () => {
    expect(validate('de', 'No books | One book | {count} books', 'Keine Bücher | Ein Buch | {count} Bücher')).toContain(
      'de: legacy plural branches are not allowed for books.count',
    )
    expect(validate('de', 'No books|One book|{count} books', 'Keine Bücher|Ein Buch|{count} Bücher')).toContain(
      'de: legacy plural branches are not allowed for books.count',
    )
  })

  it('requires matching ICU arguments and exact selectors', () => {
    const reference = '{count, plural, =0 {No books for {name}} one {One book for {name}} other {# books for {name}}}'
    const message = '{count, plural, one {Ein Buch} other {# Bücher}}'

    expect(validate('de', reference, message)).toEqual(['de: ICU arguments differ for books.count', 'de: ICU selector =0 missing for books.count'])
  })

  it('requires matching ICU argument types and styles', () => {
    const reference = '{count, plural, one {One book for {name}} other {# books for {name}}}'
    const changedType = '{count, plural, one {Ein Buch für {name, number}} other {# Bücher für {name, number}}}'

    expect(validate('de', reference, changedType)).toContain('de: ICU argument types differ for books.count')

    const styledReference = '{count, plural, one {{amount, number, integer} book} other {{amount, number, integer} books}}'
    const changedStyle = '{count, plural, one {{amount, number, percent} Buch} other {{amount, number, percent} Bücher}}'

    expect(validate('de', styledReference, changedStyle)).toContain('de: ICU argument types differ for books.count')
  })

  it('rejects empty ICU options', () => {
    const reference = '{count, plural, one {One book} other {# books}}'
    const message = '{count, plural, one {} other {# Bücher}}'

    expect(validate('de', reference, message)).toContain('de: empty ICU option one for count in books.count')
  })

  it('requires matching plural offsets', () => {
    const reference = '{count, plural, one {One book} other {# books}}'
    const message = '{count, plural, offset:1 one {Ein Buch} other {# Bücher}}'

    expect(validate('de', reference, message)).toContain('de: ICU plural expressions differ for books.count')
  })

  it('requires locale-specific cardinal categories', () => {
    const reference = '{count, plural, one {# book} other {# books}}'
    const message = '{count, plural, one {# knjiga} other {# knjig}}'

    expect(validate('sl', reference, message)).toEqual([
      'sl: ICU plural category two missing for books.count',
      'sl: ICU plural category few missing for books.count',
    ])
  })

  it('reports invalid ICU and rejects legacy branches for migrated keys', () => {
    const reference = '{count, plural, one {One book} other {# books}}'

    expect(validate('de', reference, '{count, plural, one {Ein Buch} other {# Bücher}')).toEqual([
      'de: invalid ICU syntax in books.count: EXPECT_ARGUMENT_CLOSING_BRACE',
    ])
    expect(validate('de', reference, 'Kein Buch | Ein Buch | {count} Bücher')).toEqual([
      'de: legacy plural branches are not allowed for ICU message books.count',
      'de: ICU plural syntax required for books.count',
    ])
  })

  it('requires slot count messages to render exactly one count', () => {
    const slotCount = (message) => validateSlotCountMessage({ key: 'books.count', locale: 'de', message })

    expect(slotCount('{count, plural, one {# Buch} other {# Bücher}}')).toEqual([])
    expect(slotCount('{count, plural, one {Ein Buch} other {# Bücher}}')).toEqual([
      'de: slot count message books.count must render exactly one # in every branch',
    ])
    expect(slotCount('{count, plural, one {# von # Büchern} other {# Bücher}}')).toEqual([
      'de: slot count message books.count must render exactly one # in every branch',
    ])
    expect(slotCount('Keine Bücher')).toEqual(['de: ICU plural syntax required for slot count message books.count'])
  })
})
