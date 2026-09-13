import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import { WIDGET_TYPES, type Library, type WidgetConfig } from '@bookorbit/types'

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
  libraryIds: Ref<number[] | null>
  saveWidgets: (widgets: WidgetConfig[], libraryIds?: readonly number[] | null) => Promise<void>
  saveLibraryScope: (libraryIds: readonly number[] | null) => Promise<void>
  DEFAULT_WIDGETS: WidgetConfig[]
}

const widgetsRef = ref<WidgetConfig[]>([])
const libraryIdsRef = ref<number[] | null>(null)
const librariesRef = ref<Library[]>([])
const saveWidgetsMock = vi.fn<(widgets: WidgetConfig[], libraryIds?: readonly number[] | null) => Promise<void>>()
const saveLibraryScopeMock = vi.fn<(libraryIds: readonly number[] | null) => Promise<void>>()

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

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: librariesRef,
    fetchLibraries: vi.fn<() => Promise<void>>(),
  }),
}))

vi.mock('../composables/useDashboardWidgets', () => ({
  useDashboardWidgets: vi.fn<UseDashboardWidgetsMock>(() => ({
    widgets: widgetsRef,
    libraryIds: libraryIdsRef,
    saveWidgets: saveWidgetsMock,
    saveLibraryScope: saveLibraryScopeMock,
    DEFAULT_WIDGETS: [],
  })),
}))

import DashboardSettingsSheet from './DashboardSettingsSheet.vue'
import { useDashboardConfig } from '../composables/useDashboardConfig'

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

function rowButtons(wrapper: VueWrapper, shelfIndex = 0) {
  const group = wrapper.findAll('[data-testid="shelf-rows"]')[shelfIndex]
  return group?.findAll('button') ?? []
}

function storedRows(): number[] {
  const raw = localStorage.getItem('bookorbit:dashboard:config')
  const parsed = JSON.parse(raw ?? '{}') as { scrollers?: { rows: number }[] }
  return (parsed.scrollers ?? []).map((scroller) => scroller.rows)
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
  // useDashboardConfig keeps module-level state, so a shelf edit in one test
  // would otherwise seed the next test's draft.
  useDashboardConfig().reset()
  widgetsRef.value = []
  libraryIdsRef.value = null
  librariesRef.value = [{ id: 1, name: 'Books' } as Library, { id: 2, name: 'Comics' } as Library]
  saveWidgetsMock.mockResolvedValue()
  saveLibraryScopeMock.mockResolvedValue()
  await setI18nLocale('en')
})

afterEach(async () => {
  await setI18nLocale('en')
})

describe('DashboardSettingsSheet', () => {
  it('defaults to all accessible libraries', async () => {
    const wrapper = await openSheet()

    const labels = wrapper.findAll('label').map((label) => label.text())
    expect(labels).toContain(en.dashboard.settings.libraryScope.allLibraries)
  })

  it('collapses the library scope and summarises the selection', async () => {
    libraryIdsRef.value = [2]

    const wrapper = await openSheet()
    const disclosure = wrapper.find('[aria-controls="dashboard-library-scope"]')

    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(disclosure.text()).toContain('Comics')

    await disclosure.trigger('click')

    expect(disclosure.attributes('aria-expanded')).toBe('true')
  })

  it('persists an explicit library subset with shelf settings', async () => {
    const wrapper = await openSheet()
    const allLibraries = wrapper.findAll('label').find((label) => label.text().includes(en.dashboard.settings.libraryScope.allLibraries))
    await allLibraries?.find('input').setValue(false)
    const comics = wrapper.findAll('label').find((label) => label.text() === 'Comics')
    await comics?.find('input').setValue(false)

    const saveButton = wrapper.findAll('button').find((button) => button.text() === en.common.save)
    await saveButton?.trigger('click')

    expect(saveLibraryScopeMock).toHaveBeenCalledWith([1])
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('requires at least one library when an explicit subset is used', async () => {
    const wrapper = await openSheet()
    const allLibraries = wrapper.findAll('label').find((label) => label.text().includes(en.dashboard.settings.libraryScope.allLibraries))
    await allLibraries?.find('input').setValue(false)
    for (const name of ['Books', 'Comics']) {
      const label = wrapper.findAll('label').find((candidate) => candidate.text() === name)
      await label?.find('input').setValue(false)
    }

    const saveButton = wrapper.findAll('button').find((button) => button.text() === en.common.save)
    expect(saveButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(en.dashboard.settings.libraryScope.required)
  })

  it('does not count inaccessible saved library ids as a valid selection', async () => {
    libraryIdsRef.value = [99]

    const wrapper = await openSheet()
    const saveButton = wrapper.findAll('button').find((button) => button.text() === en.common.save)

    expect(saveButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(en.dashboard.settings.libraryScope.required)
  })

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

  it('offers wide-row and two-column shelf layouts', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    const wideButton = wrapper.findAll('button').find((button) => button.text().includes(en.dashboard.settings.shelfLayout.wide))
    const twoColumnButton = wrapper.findAll('button').find((button) => button.text().includes(en.dashboard.settings.shelfLayout.twoColumns))

    expect(wideButton?.attributes('aria-pressed')).toBe('true')
    expect(twoColumnButton?.attributes('aria-pressed')).toBe('false')

    await twoColumnButton?.trigger('click')

    expect(wideButton?.attributes('aria-pressed')).toBe('false')
    expect(twoColumnButton?.attributes('aria-pressed')).toBe('true')
  })

  it('translates the shelf selector when the locale changes', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    await setI18nLocale('pt')
    await nextTick()

    expect(shelfOptionLabels(wrapper).sort()).toEqual(Object.values(PT_SHELF_NAMES).sort())
  })

  it('opens on the shelves tab and lists it before widgets', async () => {
    const wrapper = await openSheet()

    const tabLabels = wrapper
      .findAll('button')
      .map((button) => button.text())
      .filter((label) => label === en.dashboard.settings.tabs.shelves || label === en.dashboard.settings.tabs.widgets)
    expect(tabLabels).toEqual([en.dashboard.settings.tabs.shelves, en.dashboard.settings.tabs.widgets])

    const shelvesTab = wrapper.findAll('button').find((button) => button.text() === en.dashboard.settings.tabs.shelves)
    const widgetsTab = wrapper.findAll('button').find((button) => button.text() === en.dashboard.settings.tabs.widgets)
    expect(shelvesTab?.classes()).toContain('bg-background')
    expect(widgetsTab?.classes()).not.toContain('bg-background')
  })

  it('offers one, two and three rows per shelf and starts on one', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    const buttons = rowButtons(wrapper)

    expect(buttons.map((button) => button.text())).toEqual(['1', '2', '3'])
    expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false'])
  })

  it('labels each row choice for assistive technology', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    expect(rowButtons(wrapper).map((button) => button.attributes('aria-label'))).toEqual(['One row of books', '2 rows of books', '3 rows of books'])
  })

  it('selects a row count without touching the other shelves', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    await rowButtons(wrapper)[2]?.trigger('click')

    expect(rowButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'true'])
    expect(rowButtons(wrapper, 1).map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false'])
  })

  it('persists the chosen row count on save', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    await rowButtons(wrapper)[1]?.trigger('click')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === en.common.save)
    await saveButton?.trigger('click')

    expect(storedRows()[0]).toBe(2)
    expect(storedRows().slice(1)).toEqual([1, 1, 1, 1, 1])
  })

  it('discards a row change when the sheet is cancelled and reopened', async () => {
    const wrapper = await openSheet()
    await openShelvesTab(wrapper)

    await rowButtons(wrapper)[2]?.trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await nextTick()
    await openShelvesTab(wrapper)

    expect(rowButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false'])
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
