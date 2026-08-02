import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import type { Locale } from '@bookorbit/types'
import cs from '@/locales/cs.json'
import da from '@/locales/da.json'
import de from '@/locales/de.json'
import en from '@/locales/en.json'
import fi from '@/locales/fi.json'
import spanish from '@/locales/es.json'
import french from '@/locales/fr.json'
import italian from '@/locales/it.json'
import nl from '@/locales/nl.json'
import polish from '@/locales/pl.json'
import pt from '@/locales/pt.json'
import ru from '@/locales/ru.json'
import sl from '@/locales/sl.json'
import sv from '@/locales/sv.json'
import uk from '@/locales/uk.json'
import zh from '@/locales/zh.json'
import { compileIcuCatalog, icuCountValues, isIcuPluralMessage, splitIcuCount } from './icu'

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

// Mirrors the production setup in `@/i18n`, where the English catalog is always
// loaded and `fallbackLocale` points at it. Without that, a key absent from a
// target catalog resolves to the key name rather than English, so a catalog
// carrying only translated keys would fail these tests instead of falling back
// the way the running application does.
function createCatalogI18n(locale: Locale, catalog: typeof en) {
  const messages: Record<string, typeof en> = {
    en: compileIcuCatalog(en, 'en'),
    [locale]: compileIcuCatalog(catalog, locale),
  }
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
}

describe('ICU message compilation', () => {
  it('detects ICU plurals without treating ordinary interpolation as ICU', () => {
    expect(isIcuPluralMessage('{count, plural, one {One book} other {# books}}')).toBe(true)
    expect(isIcuPluralMessage('Hello, {name}!')).toBe(false)
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
  ] as const)('isolates the styled count in both dialogs for %s', (locale, catalog, counts) => {
    const testI18n = createCatalogI18n(locale, catalog)

    for (const key of ['tools.bulkRename.confirmDialog.body', 'tools.entityManager.bulkDeleteModal.confirm']) {
      for (const count of counts) {
        const normalMessage = testI18n.global.t(key, { count })
        const parts = splitIcuCount(testI18n.global.t(key, icuCountValues(count)))
        expect(parts.filter((part) => part.isCount)).toHaveLength(1)
        expect(parts.map((part) => part.value).join('')).toBe(normalMessage)
      }
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

  it('renders reviewed Italian and Polish count messages with the correct grammar', () => {
    const italianI18n = createCatalogI18n('it', italian)
    const polishI18n = createCatalogI18n('pl', polish)

    expect(italianI18n.global.t('settings.appearance.icons.selectedCount', { count: 1 })).toBe('1 icona selezionata')
    expect(italianI18n.global.t('settings.appearance.icons.selectedCount', { count: 2 })).toBe('2 icone selezionate')
    expect(italianI18n.global.t('annotations.bulk.countSelected', { count: 1 })).toBe('1 annotazione selezionata')
    expect(italianI18n.global.t('annotations.bulk.countSelected', { count: 2 })).toBe('2 annotazioni selezionate')

    expect([1, 2, 5].map((count) => polishI18n.global.t('settings.privacySharing.durationHours', { count }))).toEqual([
      '1 godzina',
      '2 godziny',
      '5 godzin',
    ])
    expect([1, 2, 5].map((count) => polishI18n.global.t('settings.metadata.autoFetch.lastRun.daysAgo', { count }))).toEqual([
      '1 dzień temu',
      '2 dni temu',
      '5 dni temu',
    ])
    expect([1, 2, 5].map((count) => polishI18n.global.t('reader.audiobook.minutes', { count }))).toEqual(['1 minuta', '2 minuty', '5 minut'])
  })

  it('keeps reviewed technical terms in their software context', () => {
    for (const catalog of [spanish, french, italian, polish]) {
      expect(catalog.settings.oidc.form.slug).toBe('Slug')
      expect(catalog.annotations.hub.exportMarkdown).toBe('Markdown')
    }

    expect(spanish.settings.metadata.autoFetch.runNow).toBe('Ejecutar ahora')
    expect(french.settings.metadata.autoFetch.runNow).toBe('Exécuter maintenant')
    expect(italian.settings.metadata.autoFetch.runNow).toBe('Esegui ora')
    expect(polish.settings.metadata.autoFetch.runNow).toBe('Uruchom teraz')
    expect(italian.settings.admin.migration.host).toBe('Host')
    expect(italian.settings.admin.migration.port).toBe('Porta')
    expect(polish.tools.bookDuplicates.selectKeeperFirst).toBe('Najpierw wybierz książkę do zachowania')
  })

  it('preserves spacing around collection names in reviewed Italian messages', () => {
    const testI18n = createCatalogI18n('it', italian)

    expect(testI18n.global.t('collection.addToSheet.createdAndAdded', { count: 2, name: 'Preferiti' })).toBe('Creata "Preferiti" e aggiunti 2 libri')
    expect(testI18n.global.t('collection.addToSheet.addedToCollection', { count: 2, name: 'Preferiti' })).toBe('Aggiunti 2 libri a "Preferiti"')
  })

  it.each([
    ['en', en, [0, 1, 2], ['No duplicate groups', 'One duplicate group', '2 duplicate groups']],
    ['de', de, [0, 1, 2], ['Keine duplizierten Gruppen', 'Eine duplizierte Gruppe', '2 duplizierte Gruppen']],
    ['es', spanish, [0, 1, 1_000_000], ['No hay grupos duplicados', 'Un grupo duplicado', '1.000.000 grupos duplicados']],
    ['fr', french, [0, 1, 1_000_000], ['Pas de groupes en double', 'Un groupe en double', '1 000 000 groupes en double']],
    ['it', italian, [0, 1, 1_000_000], ['Nessun gruppo duplicato', 'Un gruppo duplicato', '1.000.000 gruppi duplicati']],
    ['nl', nl, [0, 1, 2], ['No duplicate groups', 'One duplicate group', '2 duplicate groups']],
    [
      'pl',
      polish,
      [0, 1, 2, 5, 1_000_000],
      ['Brak zduplikowanych grup', 'Jedna zduplikowana grupa', '2 zduplikowane grupy', '5 zduplikowanych grup', '1 000 000 zduplikowanych grup'],
    ],
    ['pt', pt, [0, 1, 1_000_000], ['Sem grupos duplicados', 'Um grupo duplicado', '1.000.000 grupos duplicados']],
    ['sl', sl, [0, 1, 2, 3, 5], ['No duplicate groups', 'One duplicate group', '2 duplicate groups', '3 duplicate groups', '5 duplicate groups']],
  ] as const)('renders migrated Book Duplicates messages for %s', (locale, catalog, counts, expectedGroups) => {
    const testI18n = createCatalogI18n(locale, catalog)

    expect(counts.map((count) => testI18n.global.t('tools.bookDuplicates.groupsFound', { count }))).toEqual(expectedGroups)

    for (const key of [
      'tools.bookDuplicates.deleteDialog.description',
      'tools.bookDuplicates.deleteDialog.confirm',
      'tools.bookDuplicates.deleteDialog.success',
    ]) {
      for (const count of counts) {
        const result = testI18n.global.t(key, { count })
        expect(result).not.toContain('{count')
        expect(result).not.toContain('plural')
      }
    }
  })

  it.each([
    ['en', en, [1, 2], ['1 failure', '2 failures']],
    ['de', de, [1, 2], ['1 Fehler', '2 Fehler']],
    ['es', spanish, [1, 1_000_000], ['1 fracaso', '1.000.000 fracasos']],
    ['fr', french, [1, 1_000_000], ['1 échec', '1 000 000 échecs']],
    ['it', italian, [1, 1_000_000], ['1 fallimento', '1.000.000 fallimenti']],
    ['nl', nl, [1, 2], ['1 fout', '2 fouten']],
    ['pl', polish, [1, 2, 5, 1_000_000], ['1 porażka', '2 niepowodzenia', '5 niepowodzeń', '1 000 000 niepowodzeń']],
    ['pt', pt, [1, 1_000_000], ['1 falha', '1.000.000 falhas']],
    ['sl', sl, [1, 2, 3, 5], ['1 napaka', '2 napaki', '3 napak', '5 napak']],
  ] as const)('renders migrated Kobo activity plurals for %s', (locale, catalog, counts, expected) => {
    const testI18n = createCatalogI18n(locale, catalog)

    expect(counts.map((count) => testI18n.global.t('settings.reader.kobo.activity.failureCount', { count }))).toEqual(expected)
  })

  it.each([
    ['en', en, [0, 1, 2], ['no files ready', '1 file ready', '2 files ready']],
    ['de', de, [0, 1, 2], ['keine Dateien bereit', '1 Datei bereit', '2 Dateien bereit']],
    ['es', spanish, [0, 1, 1_000_000], ['no hay archivos listos', '1 archivo listo', '1.000.000 archivos listos']],
    ['fr', french, [0, 1, 1_000_000], ["aucun fichier n'est prêt", '1 fichier prêt', '1 000 000 fichiers prêts']],
    ['it', italian, [0, 1, 1_000_000], ['nessun file pronto', '1 file pronto', '1.000.000 file pronti']],
    ['nl', nl, [0, 1, 2], ['geen bestanden gereed', '1 bestand gereed', '2 bestanden gereed']],
    [
      'pl',
      polish,
      [0, 1, 2, 5, 1_000_000],
      ['brak gotowych plików', '1 plik gotowy', '2 pliki gotowe', '5 plików gotowych', '1 000 000 plików gotowych'],
    ],
    ['pt', pt, [0, 1, 1_000_000], ['nenhum arquivo pronto', '1 arquivo pronto', '1.000.000 arquivos prontos']],
    [
      'sl',
      sl,
      [0, 1, 2, 3, 5],
      ['0 datotek pripravljenih', '1 datoteka pripravljena', '2 datoteki pripravljeni', '3 datoteke pripravljene', '5 datotek pripravljenih'],
    ],
  ] as const)('renders migrated finalize-dialog counts for %s', (locale, catalog, counts, expected) => {
    const testI18n = createCatalogI18n(locale, catalog)

    expect(counts.map((count) => testI18n.global.t('bookDock.finalizeDialog.readyCount', { count }))).toEqual(expected)
  })

  it('uses the reviewed Slovenian zero/one/other mappings in the finalize dialog', () => {
    const testI18n = createCatalogI18n('sl', sl)

    expect(testI18n.global.t('bookDock.finalizeDialog.title', { count: 0 })).toBe('Zaključi brez datotek')
    expect(testI18n.global.t('bookDock.finalizeDialog.title', { count: 1 })).toBe('Zaključi 1 datoteko')
    expect(testI18n.global.t('bookDock.finalizeDialog.needDestination', { count: 1, without: 0 })).toBe('0 od 1 izbrane datoteke potrebuje cilj')
    expect(testI18n.global.t('bookDock.finalizeDialog.failedWithDuplicates', { count: 1, failed: 2 })).toBe('2 neuspešna (1 podvojena)')
  })

  it.each([
    ['en', en, [0, 1, 2]],
    // Czech inverts the Russian mapping: 5 is `other` and `many` is the fraction.
    ['cs', cs, [0, 1, 2, 5, 1.5]],
    ['da', da, [0, 1, 2]],
    ['de', de, [0, 1, 2]],
    ['es', spanish, [0, 1, 2, 1_000_000]],
    ['fi', fi, [0, 1, 2]],
    ['fr', french, [0, 1, 2, 1_000_000]],
    ['it', italian, [0, 1, 2, 1_000_000]],
    ['nl', nl, [0, 1, 2]],
    // Polish reserves `other` for fractions, exactly as Czech does.
    ['pl', polish, [0, 1, 2, 5, 1.5, 1_000_000]],
    ['pt', pt, [0, 1, 2, 1_000_000]],
    // Russian and Ukrainian reach `other` only through a fraction; 5 is `many`.
    ['ru', ru, [0, 1, 2, 5, 1.5]],
    ['sl', sl, [0, 1, 2, 3, 5]],
    ['sv', sv, [0, 1, 2]],
    ['uk', uk, [0, 1, 2, 5, 1.5]],
    ['zh', zh, [0, 1, 2]],
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
