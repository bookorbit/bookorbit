import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import { WIDGET_TYPES, type WidgetConfig } from '@bookorbit/types'

import { setI18nLocale } from '@/i18n'
import en from '@/locales/en.json'
import pt from '@/locales/pt.json'

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

    expect(shelfOptionLabels(wrapper).sort()).toEqual(Object.values(pt.dashboard.settings.shelfNames).sort())
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
      pt.dashboard.settings.widgetNames.readingStreak,
      pt.dashboard.settings.widgetNames.currentlyReading,
      pt.dashboard.settings.widgetNames.readingGoal,
      pt.dashboard.settings.widgetNames.readingDna,
      pt.dashboard.settings.widgetNames.monthlyChallenge,
      pt.dashboard.settings.widgetNames.highlightOfTheDay,
      pt.dashboard.settings.widgetNames.neglectedGems,
      pt.dashboard.settings.widgetNames.readingRhythm,
      pt.dashboard.settings.widgetNames.diversityScore,
      pt.dashboard.settings.widgetNames.libraryOverview,
      pt.dashboard.settings.widgetNames.yearProjection,
      pt.dashboard.settings.widgetNames.longWait,
    ])
    expect(labels).not.toContain(en.dashboard.settings.widgetNames.readingStreak)
    expect(labels).not.toContain(en.dashboard.settings.widgetNames.currentlyReading)
  })
})
