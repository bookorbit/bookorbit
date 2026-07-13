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
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
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
})
