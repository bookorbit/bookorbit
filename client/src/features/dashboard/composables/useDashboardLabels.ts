import { useI18n } from 'vue-i18n'

import type { ScrollerConfig, ScrollerType, WidgetType } from '@bookorbit/types'
import type { MessageSchema } from '@/i18n'

type WidgetNameKey = keyof MessageSchema['dashboard']['settings']['widgetNames']
type ShelfNameKey = keyof MessageSchema['dashboard']['settings']['shelfNames']

// Typed against the English catalog so a renamed or removed message fails typecheck
// instead of silently rendering a raw key path.
const WIDGET_NAME_KEYS: Record<WidgetType, WidgetNameKey> = {
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

const SHELF_NAME_KEYS: Record<ScrollerType, ShelfNameKey> = {
  'recently-added': 'recentlyAdded',
  'continue-reading': 'continueReading',
  'continue-listening': 'continueListening',
  'want-to-read': 'wantToRead',
  'up-next-in-series': 'upNextInSeries',
  random: 'random',
  'smart-scope': 'smartScope',
}

export function useDashboardLabels() {
  const { t } = useI18n()

  function widgetName(type: WidgetType): string {
    return t(`dashboard.settings.widgetNames.${WIDGET_NAME_KEYS[type]}`)
  }

  function shelfTypeName(type: ScrollerType): string {
    return t(`dashboard.settings.shelfNames.${SHELF_NAME_KEYS[type]}`)
  }

  // A Smart Scope shelf is titled with the user's own scope name, which is content and stays
  // untranslated. Every other shelf resolves from its type: the persisted `label` predates
  // localization and holds a fixed English string that would survive a language change.
  function shelfTitle(scroller: ScrollerConfig): string {
    if (scroller.type !== 'smart-scope') return shelfTypeName(scroller.type)
    const smartScopeName = scroller.smartScopeId ? scroller.label.trim() : ''
    return smartScopeName || shelfTypeName('smart-scope')
  }

  return { widgetName, shelfTypeName, shelfTitle }
}
