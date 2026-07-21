import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import KoreaderFileNamingSettings from '../KoreaderFileNamingSettings.vue'

const fileNamingPattern = ref('{authors}/{title}')
const fetchFileNamingPattern = vi.fn<() => Promise<void>>()
const saveFileNamingPattern = vi.fn<(payload: { pattern: string }) => Promise<void>>()
const saveDeviceFileNamingPattern =
  vi.fn<(deviceId: string, config: { pattern: string; seriesPattern: string; standalonePattern: string }) => Promise<void>>()
const clearDeviceFileNamingPattern = vi.fn<(deviceId: string) => Promise<void>>()
const { MockKoreaderFileNamingRequestError, toastSuccess, toastError } = vi.hoisted(() => ({
  MockKoreaderFileNamingRequestError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  toastSuccess: vi.fn<() => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/features/koreader/composables/useKoreaderSync', () => ({
  KoreaderFileNamingRequestError: MockKoreaderFileNamingRequestError,
  useKoreaderSync: () => ({
    fileNamingPattern,
    fetchFileNamingPattern,
    saveFileNamingPattern,
    saveDeviceFileNamingPattern,
    clearDeviceFileNamingPattern,
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div data-testid="tooltip"><slot /></div>' },
  TooltipContent: { template: '<div data-testid="tooltip-content"><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))

function deferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('KoreaderFileNamingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileNamingPattern.value = '{authors}/{title}'
    fetchFileNamingPattern.mockResolvedValue(undefined)
    saveFileNamingPattern.mockImplementation(async ({ pattern }) => {
      fileNamingPattern.value = pattern
    })
  })

  it('disables account save until the pattern changes and prevents duplicate pending saves', async () => {
    const pending = deferredPromise()
    saveFileNamingPattern.mockImplementation(({ pattern }) =>
      pending.promise.then(() => {
        fileNamingPattern.value = pattern
      }),
    )
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices: [] },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('settings.reader.koreader.fileNaming.')
    const saveButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Save')
    expect(saveButton).toBeDefined()
    expect(saveButton!.attributes('disabled')).toBeDefined()

    await wrapper.find('textarea').setValue('LiveTest/{authors}/{title}')
    expect(saveButton!.attributes('disabled')).toBeUndefined()

    void saveButton!.trigger('click')
    void saveButton!.trigger('click')

    expect(saveFileNamingPattern).toHaveBeenCalledTimes(1)
    expect(saveFileNamingPattern).toHaveBeenCalledWith({ pattern: 'LiveTest/{authors}/{title}' })

    await wrapper.vm.$nextTick()
    expect(saveButton!.attributes('disabled')).toBeDefined()

    pending.resolve()
    await flushPromises()
    expect(saveButton!.attributes('disabled')).toBeDefined()

    await saveButton!.trigger('click')
    expect(saveFileNamingPattern).toHaveBeenCalledTimes(1)
  })

  it('reports account-pattern load and save failures', async () => {
    fetchFileNamingPattern.mockRejectedValueOnce(new MockKoreaderFileNamingRequestError('load'))
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices: [] },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('Failed to load file organization settings')

    saveFileNamingPattern.mockRejectedValueOnce(new MockKoreaderFileNamingRequestError('account-save'))
    await wrapper.find('textarea').setValue('Changed/{title}')
    const saveButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Save')!
    await saveButton.trigger('click')
    await flushPromises()

    expect(saveFileNamingPattern).toHaveBeenCalledWith({ pattern: 'Changed/{title}' })
    expect(toastError).toHaveBeenCalledWith('Failed to save file organization settings')
  })

  it('saves, clears, and resets device overrides', async () => {
    const devices = [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: null,
        latestPluginVersion: null,
        updateAvailable: null,
        lastSweepAt: '2026-07-01T00:00:00.000Z',
        lastSweepBooksMatched: 0,
        lastSweepPageStats: 0,
        lastSweepAnnotations: 0,
        fileNamingPattern: 'Old/{title}',
        seriesFileNamingPattern: null,
        standaloneFileNamingPattern: null,
      },
    ]
    saveDeviceFileNamingPattern.mockResolvedValue(undefined)
    clearDeviceFileNamingPattern.mockResolvedValue(undefined)
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    await textareas[1]!.setValue('Custom/{title}')
    await textareas[2]!.setValue('Series/{series}/{title}')
    const saveOverride = wrapper.findAll('button').find((button) => button.text().includes('Save override'))!
    await saveOverride.trigger('click')
    await flushPromises()

    expect(saveDeviceFileNamingPattern).toHaveBeenCalledWith('device-1', {
      pattern: 'Custom/{title}',
      seriesPattern: 'Series/{series}/{title}',
      standalonePattern: '',
    })
    expect(toastSuccess).toHaveBeenCalled()

    await textareas[1]!.setValue('{authors}/{title}')
    await textareas[2]!.setValue('')
    await saveOverride.trigger('click')
    await flushPromises()
    expect(clearDeviceFileNamingPattern).toHaveBeenCalledWith('device-1')

    await textareas[1]!.setValue('Another/{title}')
    const useAccount = wrapper.findAll('button').find((button) => button.text().includes('Use account'))!
    await useAccount.trigger('click')
    await flushPromises()
    expect(clearDeviceFileNamingPattern).toHaveBeenCalledTimes(2)
  })

  it('reports device save and reset failures', async () => {
    const devices = [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: null,
        latestPluginVersion: null,
        updateAvailable: null,
        lastSweepAt: '2026-07-01T00:00:00.000Z',
        lastSweepBooksMatched: 0,
        lastSweepPageStats: 0,
        lastSweepAnnotations: 0,
        fileNamingPattern: 'Old/{title}',
        seriesFileNamingPattern: null,
        standaloneFileNamingPattern: null,
      },
    ]
    saveDeviceFileNamingPattern.mockRejectedValueOnce(new MockKoreaderFileNamingRequestError('device-save'))
    clearDeviceFileNamingPattern.mockRejectedValueOnce(new MockKoreaderFileNamingRequestError('device-reset'))
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    await wrapper.findAll('textarea')[1]!.setValue('Broken/{title}')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save override'))!
      .trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('Failed to save device override')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Use account'))!
      .trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('Failed to reset device override')
  })

  it('keeps device inheritance tied to the persisted account pattern while the account draft is dirty', async () => {
    const devices = [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: null,
        latestPluginVersion: null,
        updateAvailable: null,
        lastSweepAt: '2026-07-01T00:00:00.000Z',
        lastSweepBooksMatched: 0,
        lastSweepPageStats: 0,
        lastSweepAnnotations: 0,
        fileNamingPattern: null,
        seriesFileNamingPattern: null,
        standaloneFileNamingPattern: null,
      },
    ]
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    await textareas[0]!.setValue('Unsaved/{title}')
    await textareas[2]!.setValue('Series/{series}/{title}')

    expect((textareas[1]!.element as HTMLTextAreaElement).value).toBe('{authors}/{title}')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save override'))!
      .trigger('click')
    await flushPromises()

    expect(saveDeviceFileNamingPattern).toHaveBeenCalledWith('device-1', {
      pattern: '',
      seriesPattern: 'Series/{series}/{title}',
      standalonePattern: '',
    })
  })

  it('provides a programmatic label for every file naming field', async () => {
    const devices = [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: null,
        latestPluginVersion: null,
        updateAvailable: null,
        lastSweepAt: '2026-07-01T00:00:00.000Z',
        lastSweepBooksMatched: 0,
        lastSweepPageStats: 0,
        lastSweepAnnotations: 0,
        fileNamingPattern: null,
        seriesFileNamingPattern: null,
        standaloneFileNamingPattern: null,
      },
    ]
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    for (const textarea of wrapper.findAll('textarea')) {
      const id = textarea.attributes('id')
      expect(id).toBeTruthy()
      expect(wrapper.find('label[for="' + id + '"]').exists()).toBe(true)
    }
  })

  it('provides visible tooltip triggers for every file naming help message', async () => {
    const devices = [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: null,
        latestPluginVersion: null,
        updateAvailable: null,
        lastSweepAt: '2026-07-01T00:00:00.000Z',
        lastSweepBooksMatched: 0,
        lastSweepPageStats: 0,
        lastSweepAnnotations: 0,
        fileNamingPattern: null,
        seriesFileNamingPattern: null,
        standaloneFileNamingPattern: null,
      },
    ]
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const helpButtons = wrapper.findAll('button[aria-label]')
    expect(helpButtons).toHaveLength(4)
    expect(helpButtons.map((button) => button.attributes('aria-label'))).toEqual([
      'Your account default for KOReader plugin downloads unless a device has a custom rule.',
      'Fallback for this device. Leave it equal to the account default to inherit future changes automatically.',
      "Optional path used only for books with series metadata. Leave empty to use this device's default path pattern.",
      "Optional path used only for books without series metadata. Leave empty to use this device's default path pattern.",
    ])
  })

  it('validates an empty account pattern and updates account and standalone drafts through their inputs', async () => {
    const devices = [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: null,
        latestPluginVersion: null,
        updateAvailable: null,
        lastSweepAt: '2026-07-01T00:00:00.000Z',
        lastSweepBooksMatched: 0,
        lastSweepPageStats: 0,
        lastSweepAnnotations: 0,
        fileNamingPattern: null,
        seriesFileNamingPattern: null,
        standaloneFileNamingPattern: null,
      },
    ]
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    await textareas[0]!.setValue('')
    await (wrapper.vm as unknown as { saveAccountDefault: () => Promise<void> }).saveAccountDefault()
    expect(toastError).toHaveBeenCalledWith('Enter a default book path pattern before saving.')

    await textareas[0]!.setValue('Account/{title}')
    await textareas[3]!.setValue('Standalone/{title}')
    expect((textareas[0]!.element as HTMLTextAreaElement).value).toBe('Account/{title}')
    expect((textareas[3]!.element as HTMLTextAreaElement).value).toBe('Standalone/{title}')
  })
})
