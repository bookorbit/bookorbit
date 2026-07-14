import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import KoreaderFileNamingSettings from '../KoreaderFileNamingSettings.vue'

const fileNamingPattern = ref('{authors}/{title}')
const fetchFileNamingPattern = vi.fn<() => Promise<void>>()
const saveFileNamingPattern = vi.fn<(payload: { pattern: string }) => Promise<void>>()
const saveDeviceFileNamingPattern = vi.fn<() => Promise<void>>()
const clearDeviceFileNamingPattern = vi.fn<() => Promise<void>>()
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn<() => void>(),
  toastError: vi.fn<() => void>(),
}))

vi.mock('@/features/koreader/composables/useKoreaderSync', () => ({
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
  })

  it('disables account save until the pattern changes and prevents duplicate pending saves', async () => {
    const pending = deferredPromise()
    saveFileNamingPattern.mockReturnValue(pending.promise)
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices: [] },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('settings.reader.koreader.fileNaming.')
    const saveButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Save')
    expect(saveButton).toBeDefined()
    expect(saveButton!.attributes('disabled')).toBeDefined()

    fileNamingPattern.value = 'LiveTest/{authors}/{title}'
    await wrapper.vm.$nextTick()
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
    fetchFileNamingPattern.mockRejectedValueOnce(new Error('load failed'))
    const wrapper = mount(KoreaderFileNamingSettings, {
      props: { devices: [] },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('load failed')

    saveFileNamingPattern.mockRejectedValueOnce(new Error('save failed'))
    fileNamingPattern.value = 'Changed/{title}'
    await wrapper.vm.$nextTick()
    const saveButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Save')!
    await saveButton.trigger('click')
    await flushPromises()

    expect(saveFileNamingPattern).toHaveBeenCalledWith({ pattern: 'Changed/{title}' })
    expect(toastError).toHaveBeenCalledWith('save failed')
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
    saveDeviceFileNamingPattern.mockRejectedValueOnce(new Error('device save failed'))
    clearDeviceFileNamingPattern.mockRejectedValueOnce(new Error('device reset failed'))
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
    expect(toastError).toHaveBeenCalledWith('device save failed')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Use account'))!
      .trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('device reset failed')
  })
})
