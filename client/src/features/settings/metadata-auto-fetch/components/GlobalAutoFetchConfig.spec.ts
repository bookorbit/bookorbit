import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import type { BookMetadataFetchConfig, BookMetadataFetchStatusEvent } from '@bookorbit/types'

// --- hoisted mocks ---------------------------------------------------------

const mockTriggerGlobal = vi.fn<() => Promise<{ queued: number }>>()
const mockSaveGlobalConfig = vi.fn<(c: BookMetadataFetchConfig) => Promise<BookMetadataFetchConfig>>()
const mockStatus = ref<BookMetadataFetchStatusEvent>({
  queued: 0,
  processing: 0,
  failed: 0,
  paused: false,
  sessionTotal: 0,
  sessionDone: 0,
  currentItemName: null,
})
const mockEligibleCount = ref<number | null>(null)
const mockCountLoading = ref(false)
const mockInvalidate = vi.fn<() => void>()

vi.mock('@/features/book-metadata-fetch/composables/useBookMetadataFetchActions', () => ({
  useBookMetadataFetchActions: () => ({ triggerGlobal: mockTriggerGlobal }),
}))

vi.mock('@/features/book-metadata-fetch/composables/useBookMetadataFetchConfig', () => ({
  useBookMetadataFetchConfig: () => ({ saveGlobalConfig: mockSaveGlobalConfig }),
}))

vi.mock('@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus', () => ({
  useBookMetadataFetchStatus: () => ({ status: mockStatus }),
}))

vi.mock('@/features/book-metadata-fetch/composables/useEligibleCountPreview', () => ({
  useEligibleCountPreview: () => ({ count: mockEligibleCount, loading: mockCountLoading }),
  invalidateEligibleCountPreviews: () => mockInvalidate(),
}))

vi.mock('@vueuse/core', () => ({
  useMediaQuery: () => ref(false),
}))

vi.mock('./ConditionConfigurator.vue', () => ({
  default: { template: '<div />' },
}))

vi.mock('@/components/ui/ToggleSwitch.vue', () => ({
  default: { template: '<input type="checkbox" />', props: ['modelValue', 'disabled'] },
}))

// ---------------------------------------------------------------------------

const { default: GlobalAutoFetchConfig } = await import('./GlobalAutoFetchConfig.vue')

function makeConfig(overrides: Partial<BookMetadataFetchConfig> = {}): BookMetadataFetchConfig {
  return {
    enabled: true,
    triggerOnImport: false,
    conditions: {
      neverFetched: { enabled: true },
      scoreThreshold: { enabled: false, threshold: 60 },
      missingFields: { enabled: false, fields: [] },
    },
    ...overrides,
  }
}

function idleStatus(): BookMetadataFetchStatusEvent {
  return { queued: 0, processing: 0, failed: 0, paused: false, sessionTotal: 0, sessionDone: 0, currentItemName: null }
}

describe('GlobalAutoFetchConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatus.value = idleStatus()
    mockEligibleCount.value = null
    mockCountLoading.value = false
    mockTriggerGlobal.mockResolvedValue({ queued: 0 })
    mockSaveGlobalConfig.mockImplementation(async (c) => c)
  })

  // -------------------------------------------------------------------------
  // statusLabel - idle queue
  // -------------------------------------------------------------------------

  it('shows eligible count when queue is idle and count is loaded', async () => {
    mockEligibleCount.value = 42
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('~42 eligible')
  })

  it('shows nothing when queue is idle and eligible count is null', async () => {
    mockEligibleCount.value = null
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    expect(wrapper.find('.hidden.md\\:flex span').exists()).toBe(false)
  })

  it('suppresses the label while eligible count is still loading', async () => {
    mockEligibleCount.value = 10
    mockCountLoading.value = true
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    expect(wrapper.find('.hidden.md\\:flex span').exists()).toBe(false)
  })

  // -------------------------------------------------------------------------
  // statusLabel - active queue
  // -------------------------------------------------------------------------

  it('shows remaining count when books are queued and processing', async () => {
    mockStatus.value = { ...idleStatus(), queued: 48, processing: 2 }
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('50 remaining')
  })

  it('shows remaining count when only queued (processing=0)', async () => {
    mockStatus.value = { ...idleStatus(), queued: 10, processing: 0 }
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('10 remaining')
  })

  it('shows paused label when queue is paused with items', async () => {
    mockStatus.value = { ...idleStatus(), queued: 30, processing: 0, paused: true }
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('30 in queue - paused')
  })

  it('queue remaining takes priority over eligible count', async () => {
    mockEligibleCount.value = 5
    mockStatus.value = { ...idleStatus(), queued: 20, processing: 1 }
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('21 remaining')
  })

  // -------------------------------------------------------------------------
  // statusLabel - after trigger
  // -------------------------------------------------------------------------

  it('shows "Queued N books" after a successful trigger', async () => {
    mockTriggerGlobal.mockResolvedValue({ queued: 2048 })
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })

    await wrapper.find('button.settings-btn-outline').trigger('click')
    await flushPromises()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('Queued 2,048 books')
  })

  it('shows "No eligible books found" when trigger returns 0', async () => {
    mockTriggerGlobal.mockResolvedValue({ queued: 0 })
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })

    await wrapper.find('button.settings-btn-outline').trigger('click')
    await flushPromises()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('No eligible books found')
  })

  it('trigger result takes priority over active queue status', async () => {
    mockStatus.value = { ...idleStatus(), queued: 100, processing: 1 }
    mockTriggerGlobal.mockResolvedValue({ queued: 50 })
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })

    await wrapper.find('button.settings-btn-outline').trigger('click')
    await flushPromises()

    expect(wrapper.find('.hidden.md\\:flex span').text()).toBe('Queued 50 books')
  })

  it('invalidates eligible count previews after trigger', async () => {
    mockTriggerGlobal.mockResolvedValue({ queued: 10 })
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })

    await wrapper.find('button.settings-btn-outline').trigger('click')
    await flushPromises()

    expect(mockInvalidate).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Mobile footer mirrors statusLabel
  // -------------------------------------------------------------------------

  it('mobile footer also shows statusLabel', async () => {
    mockEligibleCount.value = 7
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    const mobileSpan = wrapper.find('.md\\:hidden.sticky span.text-muted-foreground')
    expect(mobileSpan.text()).toBe('~7 eligible')
  })

  it('mobile footer shows remaining count when queue is active', async () => {
    mockStatus.value = { ...idleStatus(), queued: 15, processing: 0 }
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    const mobileSpan = wrapper.find('.md\\:hidden.sticky span.text-muted-foreground')
    expect(mobileSpan.text()).toBe('15 remaining')
  })

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  it('calls saveGlobalConfig and emits updated when save is clicked', async () => {
    const updated = makeConfig({ enabled: false })
    mockSaveGlobalConfig.mockResolvedValue(updated)
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })

    await wrapper.find('button.settings-btn-primary').trigger('click')
    await flushPromises()

    expect(mockSaveGlobalConfig).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('updated')).toEqual([[updated]])
  })

  it('disables save button while saving', async () => {
    let resolvePromise!: (v: BookMetadataFetchConfig) => void
    mockSaveGlobalConfig.mockReturnValue(new Promise((r) => (resolvePromise = r)))
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })

    const btn = wrapper.find('button.settings-btn-primary')
    await btn.trigger('click')
    await nextTick()

    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    resolvePromise(makeConfig())
    await flushPromises()
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables trigger button while triggering', async () => {
    let resolvePromise!: (v: { queued: number }) => void
    mockTriggerGlobal.mockReturnValue(new Promise((r) => (resolvePromise = r)))
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })

    const btn = wrapper.find('button.settings-btn-outline')
    await btn.trigger('click')
    await nextTick()

    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    resolvePromise({ queued: 0 })
    await flushPromises()
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Conditions panel toggle
  // -------------------------------------------------------------------------

  it('hides ConditionConfigurator when conditions panel is collapsed', async () => {
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: makeConfig() } })
    await nextTick()

    // ChevronUp is shown when open (conditionsOpen=true by default)
    expect(wrapper.findComponent({ name: 'ChevronUp' }).exists()).toBe(false)

    // Click to collapse
    await wrapper.find('.bg-card button.w-full').trigger('click')
    await nextTick()

    // After collapse ChevronDown takes over for conditions toggle - collapsed state
    expect(wrapper.find('.bg-card button.w-full').exists()).toBe(true)
  })

  it('updates local config when config prop changes', async () => {
    const original = makeConfig({ enabled: true })
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config: original } })
    await nextTick()

    const updated = makeConfig({ enabled: false })
    await wrapper.setProps({ config: updated })
    await nextTick()

    const toggles = wrapper.findAll('input[type="checkbox"]')
    expect(toggles.length).toBeGreaterThan(0)
  })

  it('activeConditionSummary lists missingFields when enabled with fields', async () => {
    const config = makeConfig({
      conditions: {
        neverFetched: { enabled: false },
        scoreThreshold: { enabled: false, threshold: 60 },
        missingFields: { enabled: true, fields: ['cover', 'description'] },
      },
    })
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config } })
    await nextTick()

    expect(wrapper.text()).toContain('Missing 2 fields')
  })

  it('activeConditionSummary uses singular "field" for exactly one missing field', async () => {
    const config = makeConfig({
      conditions: {
        neverFetched: { enabled: false },
        scoreThreshold: { enabled: false, threshold: 60 },
        missingFields: { enabled: true, fields: ['cover'] },
      },
    })
    const wrapper = mount(GlobalAutoFetchConfig, { props: { config } })
    await nextTick()

    expect(wrapper.text()).toContain('Missing 1 field')
    expect(wrapper.text()).not.toContain('fields')
  })
})
