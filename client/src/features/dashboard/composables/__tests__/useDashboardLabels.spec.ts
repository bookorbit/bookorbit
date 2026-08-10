import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { SCROLLER_TYPES, WIDGET_TYPES, type ScrollerConfig, type ScrollerType, type WidgetType } from '@bookorbit/types'

import { i18n, setI18nLocale } from '@/i18n'
import en from '@/locales/en.json'
import pt from '@/locales/pt.json'
import { useDashboardLabels } from '../useDashboardLabels'

// The composable calls useI18n(), so it has to run inside a component setup.
function mountComposable(): ReturnType<typeof useDashboardLabels> {
  let result!: ReturnType<typeof useDashboardLabels>
  mount(
    {
      setup() {
        result = useDashboardLabels()
        return () => null
      },
    },
    { global: { plugins: [i18n] } },
  )
  return result
}

type CatalogNames = { widgetNames: Record<string, string>; shelfNames: Record<string, string> }

// Production falls back to English for any key a target catalog has not translated,
// so the expected label is the Portuguese one where it exists and English otherwise.
// Reading pt directly would assert `undefined` against rendered English the first
// time Portuguese lags behind a new dashboard key.
const CATALOGS: Record<'en' | 'pt', CatalogNames> = {
  en: en.dashboard.settings,
  pt: {
    widgetNames: { ...en.dashboard.settings.widgetNames, ...pt.dashboard.settings.widgetNames },
    shelfNames: { ...en.dashboard.settings.shelfNames, ...pt.dashboard.settings.shelfNames },
  },
}

// Mirrors the kebab-case type to camel-case message key mapping the composable owns.
// Declared independently so a mistake in either map fails the test rather than cancelling out.
const WIDGET_KEY_BY_TYPE: Record<WidgetType, string> = {
  'reading-streak': 'readingStreak',
  'currently-reading': 'currentlyReading',
  'reading-goal': 'readingGoal',
  'reading-dna': 'readingDna',
  'monthly-challenge': 'monthlyChallenge',
  'highlight-of-the-day': 'highlightOfTheDay',
  'neglected-gems': 'neglectedGems',
  'reading-rhythm': 'readingRhythm',
  'diversity-score': 'diversityScore',
  'library-overview': 'libraryOverview',
  'year-projection': 'yearProjection',
  'long-wait': 'longWait',
}

// A widget whose Portuguese name genuinely differs from English. Assertions that a
// translated label is not the English one only hold for such a widget: a name that
// falls back to English renders the English string for a legitimate reason.
const PT_TRANSLATED_WIDGET = (Object.keys(WIDGET_KEY_BY_TYPE) as WidgetType[]).find(
  (type) => CATALOGS.pt.widgetNames[WIDGET_KEY_BY_TYPE[type]] !== CATALOGS.en.widgetNames[WIDGET_KEY_BY_TYPE[type]],
)

const SHELF_KEY_BY_TYPE: Record<ScrollerType, string> = {
  'recently-added': 'recentlyAdded',
  'continue-reading': 'continueReading',
  'continue-listening': 'continueListening',
  'want-to-read': 'wantToRead',
  'up-next-in-series': 'upNextInSeries',
  random: 'random',
  'smart-scope': 'smartScope',
}

function smartScopeShelf(overrides: Partial<ScrollerConfig> = {}): ScrollerConfig {
  return { id: '1', type: 'smart-scope', label: 'Unread Favorites', enabled: true, order: 1, limit: 20, smartScopeId: 42, ...overrides }
}

beforeEach(async () => {
  await setI18nLocale('en')
})

afterEach(async () => {
  await setI18nLocale('en')
})

describe('useDashboardLabels', () => {
  describe('widgetName', () => {
    it('resolves every widget type through the English catalog', () => {
      const { widgetName } = mountComposable()

      expect(WIDGET_TYPES.length).toBe(Object.keys(CATALOGS.en.widgetNames).length)
      for (const type of WIDGET_TYPES) {
        const key = WIDGET_KEY_BY_TYPE[type]
        expect(widgetName(type), `widget name for ${type}`).toBe(CATALOGS.en.widgetNames[key])
      }
    })

    it('never leaks a raw message path for any widget type', () => {
      const { widgetName } = mountComposable()

      for (const type of WIDGET_TYPES) {
        const name = widgetName(type)
        expect(name.length, `widget name for ${type}`).toBeGreaterThan(0)
        expect(name, `widget name for ${type}`).not.toContain('dashboard.settings')
      }
    })

    it('gives every widget type a distinct name so the customization list is unambiguous', () => {
      const { widgetName } = mountComposable()

      const names = WIDGET_TYPES.map((type) => widgetName(type))

      expect(new Set(names).size).toBe(WIDGET_TYPES.length)
    })

    it('follows the active locale instead of rendering hardcoded English (issue #796)', async () => {
      const { widgetName } = mountComposable()

      await setI18nLocale('pt')

      for (const type of WIDGET_TYPES) {
        const key = WIDGET_KEY_BY_TYPE[type]
        expect(widgetName(type), `widget name for ${type}`).toBe(CATALOGS.pt.widgetNames[key])
      }
      expect(PT_TRANSLATED_WIDGET, 'Portuguese should translate at least one widget name').toBeDefined()
      const translatedKey = WIDGET_KEY_BY_TYPE[PT_TRANSLATED_WIDGET!]
      expect(widgetName(PT_TRANSLATED_WIDGET!)).not.toBe(CATALOGS.en.widgetNames[translatedKey])
    })

    it('re-resolves when the locale changes back', async () => {
      const { widgetName } = mountComposable()

      expect(PT_TRANSLATED_WIDGET, 'Portuguese should translate at least one widget name').toBeDefined()
      const type = PT_TRANSLATED_WIDGET!

      await setI18nLocale('pt')
      const translated = widgetName(type)
      await setI18nLocale('en')

      expect(translated).not.toBe(widgetName(type))
      expect(widgetName(type)).toBe(CATALOGS.en.widgetNames[WIDGET_KEY_BY_TYPE[type]])
    })
  })

  describe('shelfTypeName', () => {
    it('resolves every scroller type through the English catalog', () => {
      const { shelfTypeName } = mountComposable()

      expect(SCROLLER_TYPES.length).toBe(Object.keys(CATALOGS.en.shelfNames).length)
      for (const type of SCROLLER_TYPES) {
        const key = SHELF_KEY_BY_TYPE[type]
        expect(shelfTypeName(type), `shelf name for ${type}`).toBe(CATALOGS.en.shelfNames[key])
      }
    })

    it('gives every scroller type a distinct name so the type selector is unambiguous', () => {
      const { shelfTypeName } = mountComposable()

      const names = SCROLLER_TYPES.map((type) => shelfTypeName(type))

      expect(new Set(names).size).toBe(SCROLLER_TYPES.length)
    })

    it('follows the active locale', async () => {
      const { shelfTypeName } = mountComposable()

      await setI18nLocale('pt')

      for (const type of SCROLLER_TYPES) {
        const key = SHELF_KEY_BY_TYPE[type]
        expect(shelfTypeName(type), `shelf name for ${type}`).toBe(CATALOGS.pt.shelfNames[key])
      }
    })
  })

  describe('shelfTitle', () => {
    it('ignores the persisted English label and resolves built-in shelves from their type', async () => {
      const { shelfTitle, shelfTypeName } = mountComposable()
      // Configs saved before localization stored a fixed English label that would otherwise
      // survive a language change.
      const stored: ScrollerConfig = { id: '1', type: 'continue-reading', label: 'Continue Reading', enabled: true, order: 1, limit: 20 }

      expect(shelfTitle(stored)).toBe(CATALOGS.en.shelfNames.continueReading)

      await setI18nLocale('pt')

      expect(shelfTitle(stored)).toBe(CATALOGS.pt.shelfNames.continueReading)
      expect(shelfTitle(stored)).toBe(shelfTypeName('continue-reading'))
    })

    it('resolves every built-in shelf type from its type rather than its label', () => {
      const { shelfTitle, shelfTypeName } = mountComposable()

      for (const type of SCROLLER_TYPES) {
        if (type === 'smart-scope') continue
        const stored: ScrollerConfig = { id: '1', type, label: 'Stale Stored Label', enabled: true, order: 1, limit: 20 }
        expect(shelfTitle(stored), `shelf title for ${type}`).toBe(shelfTypeName(type))
      }
    })

    it('keeps the user-authored smart scope name untranslated', async () => {
      const { shelfTitle } = mountComposable()
      const shelf = smartScopeShelf({ label: 'Unread Favorites' })

      expect(shelfTitle(shelf)).toBe('Unread Favorites')

      await setI18nLocale('pt')

      expect(shelfTitle(shelf)).toBe('Unread Favorites')
    })

    it('trims surrounding whitespace from a smart scope name', () => {
      const { shelfTitle } = mountComposable()

      expect(shelfTitle(smartScopeShelf({ label: '  Unread Favorites  ' }))).toBe('Unread Favorites')
    })

    it('falls back to the localized generic name when a smart scope shelf references no scope', async () => {
      const { shelfTitle } = mountComposable()
      const shelf = smartScopeShelf({ smartScopeId: undefined, label: 'SmartScope' })

      expect(shelfTitle(shelf)).toBe(CATALOGS.en.shelfNames.smartScope)

      await setI18nLocale('pt')

      expect(shelfTitle(shelf)).toBe(CATALOGS.pt.shelfNames.smartScope)
    })

    it('falls back to the localized generic name when the smart scope name is blank', () => {
      const { shelfTitle } = mountComposable()

      expect(shelfTitle(smartScopeShelf({ label: '   ' }))).toBe(CATALOGS.en.shelfNames.smartScope)
    })
  })
})
