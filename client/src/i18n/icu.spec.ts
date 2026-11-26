import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import type { Locale } from '@bookorbit/types'
import cs from '@/locales/cs.json'
import da from '@/locales/da.json'
import de from '@/locales/de.json'
import greek from '@/locales/el.json'
import en from '@/locales/en.json'
import fi from '@/locales/fi.json'
import spanish from '@/locales/es.json'
import french from '@/locales/fr.json'
import hungarian from '@/locales/hu.json'
import indonesian from '@/locales/id.json'
import italian from '@/locales/it.json'
import japanese from '@/locales/ja.json'
import korean from '@/locales/ko.json'
import nl from '@/locales/nl.json'
import polish from '@/locales/pl.json'
import pt from '@/locales/pt.json'
import romanian from '@/locales/ro.json'
import ru from '@/locales/ru.json'
import slovak from '@/locales/sk.json'
import sl from '@/locales/sl.json'
import sv from '@/locales/sv.json'
import turkish from '@/locales/tr.json'
import uk from '@/locales/uk.json'
import zh from '@/locales/zh.json'
import traditionalChinese from '@/locales/zh-Hant.json'
import { compileIcuCatalog, icuCountValues, isIcuPluralMessage, splitIcuCount } from './icu'
import { i18n as applicationI18n } from './index'

afterEach(() => vi.restoreAllMocks())

function flattenMessages(value: unknown, prefix = '', output = new Map<string, string>()): Map<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output
  for (const [key, child] of Object.entries(value)) {
    const messageKey = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') output.set(messageKey, child)
    else flattenMessages(child, messageKey, output)
  }
  return output
}

function messageValues(message: string, count: number): Record<string, string | number> {
  const argumentNames = [...message.matchAll(/\{\s*([\w.-]+)(?:\s*[,}])/g)].map((match) => match[1])
  return Object.fromEntries(argumentNames.map((name) => [name, name === 'count' ? count : 2]))
}

// Target catalogs hold only the keys Crowdin has translated, so they are a subset of the English
// catalog rather than an exact match. Typing them against `typeof en` would fail a branch that
// authors a new English key before its translations exist.
type MessageTree = { [key: string]: string | MessageTree }

// Mirrors the production setup in `@/i18n`, where the English catalog is always
// loaded and `fallbackLocale` points at it. Without that, a key absent from a
// target catalog resolves to the key name rather than English, so a catalog
// carrying only translated keys would fail these tests instead of falling back
// the way the running application does.
function createCatalogI18n(locale: Locale, catalog: MessageTree) {
  const messages: Record<string, MessageTree> = {
    en: compileIcuCatalog(en, 'en'),
    [locale]: compileIcuCatalog(catalog, locale),
  }
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages })
}

describe('ICU message compilation', () => {
  it('suppresses warnings for intentional English catalog fallback', () => {
    expect(applicationI18n.global.missingWarn).toBe(false)
    expect(applicationI18n.global.fallbackWarn).toBe(false)
  })

  it('detects ICU plurals without treating ordinary interpolation as ICU', () => {
    expect(isIcuPluralMessage('{count, plural, one {One book} other {# books}}')).toBe(true)
    expect(isIcuPluralMessage('Hello, {name}!')).toBe(false)
  })

  it('uses English plural rules when a target catalog omits an ICU message', () => {
    const testI18n = createCatalogI18n('zh', {})

    expect(testI18n.global.t('book.move.title', { count: 1 })).toBe('Move 1 book')
    expect(testI18n.global.t('book.move.title', { count: 2 })).toBe('Move 2 books')
  })

  it('falls back per key inside a partially translated branch without warning noise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const testI18n = createCatalogI18n('cs', {
      book: { move: { subtitle: 'Soubory se přesunou do cílové knihovny.' } },
    })

    expect(testI18n.global.t('book.move.subtitle')).toBe('Soubory se přesunou do cílové knihovny.')
    expect(testI18n.global.t('book.move.searchPlaceholder')).toBe('Search libraries')
    expect(testI18n.global.t('book.move.title', { count: 2 })).toBe('Move 2 books')
    expect(warn).not.toHaveBeenCalled()
  })

  it('compiles ICU plurals while preserving ordinary Vue messages', () => {
    const messages = compileIcuCatalog(
      {
        books: '{count, plural, =0 {No books} one {One book} other {# books}}',
        greeting: 'Hello, {name}!',
      },
      'en',
    )
    const testI18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: messages },
    })

    expect(testI18n.global.t('books', { count: 0 })).toBe('No books')
    expect(testI18n.global.t('books', { count: 1 })).toBe('One book')
    expect(testI18n.global.t('books', { count: 12 })).toBe('12 books')
    expect(testI18n.global.t('greeting', { name: 'Ada' })).toBe('Hello, Ada!')
  })

  it('marks the ICU count token without matching translated text', () => {
    const messages = compileIcuCatalog(
      {
        books: '{count, plural, one {The number 1 appears before # book} other {The number 1 appears before # books}}',
      },
      'en',
    )
    const testI18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: messages },
    })

    expect(splitIcuCount(testI18n.global.t('books', icuCountValues(1)))).toEqual([
      { isCount: false, value: 'The number 1 appears before ' },
      { isCount: true, value: '1' },
      { isCount: false, value: ' book' },
    ])
  })

  it.each([
    ['en', en, [0, 1, 2, 1_234]],
    ['de', de, [0, 1, 2, 1_234]],
    ['es', spanish, [0, 1, 2, 1_000_000]],
    ['fr', french, [0, 1, 2, 1_000_000]],
    ['it', italian, [0, 1, 2, 1_000_000]],
    ['nl', nl, [0, 1, 2, 1_234]],
    ['pl', polish, [0, 1, 2, 5, 1_000_000]],
    ['pt', pt, [0, 1, 2, 1_234]],
    ['sl', sl, [0, 1, 2, 3, 5, 1_234]],
  ] as const)('isolates the styled count in the bulk delete dialog for %s', (locale, catalog, counts) => {
    const testI18n = createCatalogI18n(locale, catalog)

    for (const count of counts) {
      const key = 'tools.entityManager.bulkDeleteModal.confirm'
      const normalMessage = testI18n.global.t(key, { count })
      const parts = splitIcuCount(testI18n.global.t(key, icuCountValues(count)))
      expect(parts.filter((part) => part.isCount)).toHaveLength(1)
      expect(parts.map((part) => part.value).join('')).toBe(normalMessage)
    }
  })

  it('falls back to the raw message when ICU arguments are missing', () => {
    const messages = compileIcuCatalog({ books: '{count, plural, one {# book} other {# books}}' }, 'en')
    const testI18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: messages },
    })

    expect(() => testI18n.global.t('books')).not.toThrow()
    expect(testI18n.global.t('books')).toBe('{count, plural, one {# book} other {# books}}')
  })

  it('uses locale-specific Slovenian plural categories', () => {
    const messages = compileIcuCatalog(
      {
        books: '{count, plural, one {# knjiga} two {# knjigi} few {# knjige} other {# knjig}}',
      },
      'sl',
    )
    const testI18n = createI18n({
      legacy: false,
      locale: 'sl',
      messages: { sl: messages },
    })

    expect(testI18n.global.t('books', { count: 1 })).toBe('1 knjiga')
    expect(testI18n.global.t('books', { count: 2 })).toBe('2 knjigi')
    expect(testI18n.global.t('books', { count: 3 })).toBe('3 knjige')
    expect(testI18n.global.t('books', { count: 5 })).toBe('5 knjig')
  })

  // Grammar the compiler must get right, checked on fixed messages. The shipped catalogs belong to
  // Crowdin, and the translation sync runs this spec on a fresh export of them.
  it.each([
    ['es', [0, 1, 2, 1_000_000], ['none 0', 'one 1', 'other 2', 'many 1.000.000']],
    ['fr', [0, 1, 1.5, 2, 1_000_000], ['none 0', 'one 1', 'one 1,5', 'other 2', 'many 1\u202f000\u202f000']],
    ['it', [0, 1, 2, 1_000_000], ['none 0', 'one 1', 'other 2', 'many 1.000.000']],
    ['pl', [0, 1, 2, 5, 22, 1.5, 1_000_000], ['none 0', 'one 1', 'few 2', 'many 5', 'few 22', 'other 1,5', 'many 1\u00a0000\u00a0000']],
  ] as const)('selects exact, plural-category and grouped-count branches in %s', (locale, counts, expected) => {
    const message = '{count, plural, =0 {none #} one {one #} few {few #} many {many #} other {other #}}'
    const testI18n = createI18n({ legacy: false, locale, messages: { [locale]: compileIcuCatalog({ books: message }, locale) } })

    expect(counts.map((count) => testI18n.global.t('books', { count }))).toEqual(expected)
  })

  it('keeps spacing and punctuation around other arguments in a plural branch', () => {
    const messages = compileIcuCatalog(
      {
        added: '{count, plural, one {Aggiunto un libro a "{name}"} other {Aggiunti # libri a "{name}"}}',
        failed: '{count, plural, one {{failed} non riusciti (# duplicato)} other {{failed} non riusciti (# duplicati)}}',
      },
      'it',
    )
    const testI18n = createI18n({ legacy: false, locale: 'it', messages: { it: messages } })

    expect(testI18n.global.t('added', { count: 1, name: 'Preferiti' })).toBe('Aggiunto un libro a "Preferiti"')
    expect(testI18n.global.t('added', { count: 2, name: 'Preferiti' })).toBe('Aggiunti 2 libri a "Preferiti"')
    expect(testI18n.global.t('failed', { count: 1, failed: 2 })).toBe('2 non riusciti (1 duplicato)')
  })

  // The Crowdin translation sync runs this spec on a fresh export, so a translator rewording one of
  // these messages must not fail it. Assert that each message renders, not what it says.
  it.each([
    ['en', en, [0, 1, 2]],
    ['de', de, [0, 1, 2]],
    ['es', spanish, [0, 1, 1_000_000]],
    ['fr', french, [0, 1, 1_000_000]],
    ['it', italian, [0, 1, 1_000_000]],
    ['nl', nl, [0, 1, 2]],
    ['pl', polish, [0, 1, 2, 5, 1_000_000]],
    ['pt', pt, [0, 1, 1_000_000]],
    ['sl', sl, [0, 1, 2, 3, 5]],
  ] as const)('renders migrated Book Duplicates messages for %s', (locale, catalog, counts) => {
    const testI18n = createCatalogI18n(locale, catalog)

    for (const key of [
      'tools.bookDuplicates.deleteDialog.success',
      'tools.bookDuplicates.deleteDialog.confirm',
      'tools.bookDuplicates.review.title',
      'tools.bookDuplicates.selection.review',
      'tools.bookDuplicates.summary.groups',
      'tools.bookDuplicates.summary.extraCopies',
    ]) {
      for (const count of counts) {
        const result = testI18n.global.t(key, { count }, count)
        expect(result).not.toContain('{count')
        expect(result).not.toContain('plural')
      }
    }
  })

  it.each([
    ['en', en, [0, 1, 2]],
    // Czech inverts the Russian mapping: 5 is `other` and `many` is the fraction.
    ['cs', cs, [0, 1, 2, 5, 1.5]],
    ['da', da, [0, 1, 2]],
    ['de', de, [0, 1, 2]],
    ['el', greek, [0, 1, 2]],
    ['es', spanish, [0, 1, 2, 1_000_000]],
    ['fi', fi, [0, 1, 2]],
    ['fr', french, [0, 1, 2, 1_000_000]],
    ['hu', hungarian, [0, 1, 2]],
    ['id', indonesian, [0, 1, 2]],
    ['it', italian, [0, 1, 2, 1_000_000]],
    ['ja', japanese, [0, 1, 2]],
    ['ko', korean, [0, 1, 2]],
    ['nl', nl, [0, 1, 2]],
    // Polish reserves `other` for fractions, exactly as Czech does.
    ['pl', polish, [0, 1, 2, 5, 1.5, 1_000_000]],
    ['pt', pt, [0, 1, 2, 1_000_000]],
    ['ro', romanian, [0, 1, 2, 20]],
    // Russian and Ukrainian reach `other` only through a fraction; 5 is `many`.
    ['ru', ru, [0, 1, 2, 5, 1.5]],
    ['sk', slovak, [0, 1, 2, 5, 1.1]],
    ['sl', sl, [0, 1, 2, 3, 5]],
    ['sv', sv, [0, 1, 2]],
    ['tr', turkish, [0, 1, 2]],
    ['uk', uk, [0, 1, 2, 5, 1.5]],
    ['zh', zh, [0, 1, 2]],
    ['zh-Hant', traditionalChinese, [0, 1, 2]],
  ] as const)('formats every ICU message for all relevant plural categories in %s', (locale, catalog, counts) => {
    const testI18n = createCatalogI18n(locale, catalog)

    for (const [key, message] of flattenMessages(catalog)) {
      if (!isIcuPluralMessage(message)) continue
      for (const count of counts) {
        const result = testI18n.global.t(key, messageValues(message, count))
        expect(result).not.toContain(', plural,')
      }
    }
  })
})
