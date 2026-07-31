import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import { WIDGET_TYPES, type WidgetConfig } from '@bookorbit/types'

import { setI18nLocale } from '@/i18n'
import en from '@/locales/en.json'
import pt from '@/locales/pt.json'

// Production falls back to English for any key a target catalog has not translated,
// so these are the labels Portuguese actually renders. Reading pt directly would
// assert `undefined` against rendered English the first time Portuguese lags
// behind a new dashboard key.
const PT_WIDGET_NAMES = { ...en.dashboard.settings.widgetNames, ...pt.dashboard.settings.widgetNames }
const PT_SHELF_NAMES = { ...en.dashboard.settings.shelfNames, ...pt.dashboard.settings.shelfNames }

type UseSmartScopesMock = () => {
  smartScopes: Ref<unknown[]>
  fetchSmartScopes: () => void
}

type UseDashboardWidgetsMock = () => {
  widgets: Ref<WidgetConfig[]>
  saveWidgets: (widgets: WidgetConfig[]) => Promise<void>
  DEFAULT_WIDGETS: WidgetConfig[]
}

const widgetsRef = ref<WidgetConfig[]>([])

vi.mock('@/components/ui/sheet', () => {
  const passthrough = { template: '<div><slot /></div>' }
  return {
    Sheet: { props: ['open'], emits: ['update:open'], template: '<div><slot /></div>' },
    SheetContent: passthrough,
    SheetHeader: passthrough,
    SheetTitle: passthrough,
  }
})

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: vi.fn<UseSmartScopesMock>(() => ({
    smartScopes: ref<unknown[]>([]),
    fetchSmartScopes: vi.fn<() => void>(),
  })),
}))

vi.mock('../composables/useDashboardWidgets', () => ({
  useDashboardWidgets: vi.fn<UseDashboardWidgetsMock>(() => ({
    widgets: widgetsRef,
    saveWidgets: vi.fn<(widgets: WidgetConfig[]) => Promise<void>>(),
    DEFAULT_WIDGETS: [],
  })),
}))

import DashboardSettingsSheet from './DashboardSettingsSheet.vue'

const ALL_WIDGETS: WidgetConfig[] = WIDGET_TYPES.map((type, index) => ({
  id: String(index + 1),
  type,
  enabled: true,
  order: index + 1,
}))

async function openSheet(): Promise<VueWrapper> {
  const wrapper = mount(DashboardSettingsSheet, { props: { open: false } })
  await wrapper.setProps({ open: true })
  await nextTick()
  return wrapper
}

async function openShelvesTab(wrapper: VueWrapper): Promise<void> {
  const shelvesTab = wrapper.findAll('button').find((button) => button.text() === en.dashboard.settings.tabs.shelves)
  await shelvesTab?.trigger('click')
}

function widgetRowLabels(wrapper: VueWrapper): string[] {
  return wrapper.findAll('span.flex-1').map((span) => span.text())
}

function shelfOptionLabels(wrapper: VueWrapper): string[] {
  return wrapper
    .find('select')
    .findAll('option')
    .map((option) => option.text())
}

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  widgetsRef.value = []
  await setI18nLocale('en')
})

afterEach(async () => {
  await setI18nLocale('en')
})

describe('DashboardSettingsSheet', () => {
  it('includes continue-listening and want-to-read in the shelf selector', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    const optionLabels = shelfOptionLabels(wrapper)

    expect(optionLabels).toContain(en.dashboard.settings.shelfNames.continueListening)
    expect(optionLabels).toContain(en.dashboard.settings.shelfNames.wantToRead)
  })

  it('lists every shelf type in the selector using catalog names', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    expect(shelfOptionLabels(wrapper).sort()).toEqual(Object.values(en.dashboard.settings.shelfNames).sort())
  })

  it('translates the shelf selector when the locale changes', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    await setI18nLocale('pt')
    await nextTick()

    expect(shelfOptionLabels(wrapper).sort()).toEqual(Object.values(PT_SHELF_NAMES).sort())
  })

  it('renders every widget name from the catalog rather than a hardcoded map', async () => {
    widgetsRef.value = ALL_WIDGETS
    const wrapper = await openSheet()

    expect(widgetRowLabels(wrapper)).toEqual([
      en.dashboard.settings.widgetNames.readingStreak,
      en.dashboard.settings.widgetNames.currentlyReading,
      en.dashboard.settings.widgetNames.readingGoal,
      en.dashboard.settings.widgetNames.readingDna,
      en.dashboard.settings.widgetNames.monthlyChallenge,
      en.dashboard.settings.widgetNames.highlightOfTheDay,
      en.dashboard.settings.widgetNames.neglectedGems,
      en.dashboard.settings.widgetNames.readingRhythm,
      en.dashboard.settings.widgetNames.diversityScore,
      en.dashboard.settings.widgetNames.libraryOverview,
      en.dashboard.settings.widgetNames.yearProjection,
      en.dashboard.settings.widgetNames.longWait,
    ])
  })

  it('translates widget names when the locale changes (issue #796)', async () => {
    widgetsRef.value = ALL_WIDGETS
    const wrapper = await openSheet()

    await setI18nLocale('pt')
    await nextTick()

    const labels = widgetRowLabels(wrapper)

    expect(labels).toEqual([
      PT_WIDGET_NAMES.readingStreak,
      PT_WIDGET_NAMES.currentlyReading,
      PT_WIDGET_NAMES.readingGoal,
      PT_WIDGET_NAMES.readingDna,
      PT_WIDGET_NAMES.monthlyChallenge,
      PT_WIDGET_NAMES.highlightOfTheDay,
      PT_WIDGET_NAMES.neglectedGems,
      PT_WIDGET_NAMES.readingRhythm,
      PT_WIDGET_NAMES.diversityScore,
      PT_WIDGET_NAMES.libraryOverview,
      PT_WIDGET_NAMES.yearProjection,
      PT_WIDGET_NAMES.longWait,
    ])

    // Only meaningful for names Portuguese actually translates. A name that falls
    // back to English renders the English label legitimately, so asserting its
    // absence would fail for a reason that is not a bug.
    const englishNamesPortugueseReplaces = (['readingStreak', 'currentlyReading'] as const)
      .filter((key) => PT_WIDGET_NAMES[key] !== en.dashboard.settings.widgetNames[key])
      .map((key) => en.dashboard.settings.widgetNames[key])

    expect(labels.filter((label) => englishNamesPortugueseReplaces.includes(label))).toEqual([])
  })
})
