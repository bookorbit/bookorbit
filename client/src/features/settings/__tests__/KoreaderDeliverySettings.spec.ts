import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KoreaderDeliverySettings from '../KoreaderDeliverySettings.vue'
import { api } from '@/lib/api'
import type { KoreaderDeviceInfo } from '@bookorbit/types'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))
const apiMock = vi.mocked(api)
const device: KoreaderDeviceInfo = {
  device: 'Reader A',
  deviceId: 'device-a',
  retiredAt: null,
  lastSyncAt: '',
  lastBookTitle: null,
  readAloudDelivery: null,
}
function createWrapper() {
  return mount(KoreaderDeliverySettings, {
    props: {
      credentials: { username: 'reader', syncEnabled: true, hideAudioOnlyBooks: true, createdAt: '', readAloudDelivery: 'audioless_epub' },
      devices: [device],
      sweeps: [],
    },
  })
}

describe('KOReader delivery settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockResolvedValue({ ok: true } as Response)
  })
  it('saves a credential default through the existing route', async () => {
    const wrapper = createWrapper()
    await wrapper.findAll('select')[0]!.setValue('original')
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/koreader/credentials',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ readAloudDelivery: 'original' }) }),
    )
    expect(wrapper.emitted('updated')).toHaveLength(1)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })
  it('saves a device override and restores inheritance explicitly', async () => {
    const wrapper = createWrapper()
    await wrapper.findAll('select')[1]!.setValue('original')
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith(
      '/api/v1/koreader/devices/device-a/delivery-settings',
      expect.objectContaining({ body: JSON.stringify({ readAloudDelivery: 'original' }) }),
    )
    await wrapper.setProps({ devices: [{ ...device, readAloudDelivery: 'original' }] })
    await wrapper.findAll('select')[1]!.setValue('')
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith(
      '/api/v1/koreader/devices/device-a/delivery-settings',
      expect.objectContaining({ body: JSON.stringify({ readAloudDelivery: null }) }),
    )
  })
  it('exposes save errors accessibly and keeps the draft', async () => {
    apiMock.mockResolvedValue({ ok: false } as Response)
    const wrapper = createWrapper()
    await wrapper.findAll('select')[0]!.setValue('original')
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect((wrapper.findAll('select')[0]!.element as HTMLSelectElement).value).toBe('original')
  })
  it('updates a clean device selector after a plugin change while preserving an unsaved draft', async () => {
    const wrapper = createWrapper()
    await wrapper.setProps({ devices: [{ ...device, readAloudDelivery: 'original' }] })
    expect((wrapper.findAll('select')[1]!.element as HTMLSelectElement).value).toBe('original')
    await wrapper.findAll('select')[1]!.setValue('audioless_epub')
    await wrapper.setProps({ devices: [{ ...device, readAloudDelivery: null }] })
    expect((wrapper.findAll('select')[1]!.element as HTMLSelectElement).value).toBe('audioless_epub')
  })
  it('deduplicates devices from progress and sweeps and hides retired devices', async () => {
    const wrapper = createWrapper()
    await wrapper.setProps({
      sweeps: [
        { deviceId: 'device-a', deviceModel: 'Reader A', retiredAt: null } as never,
        { deviceId: 'retired', deviceModel: 'Old', retiredAt: '2026-01-01' } as never,
      ],
    })
    expect(wrapper.findAll('select')).toHaveLength(2)
    for (const select of wrapper.findAll('select')) {
      expect(wrapper.find(`label[for="${select.attributes('id')}"]`).exists()).toBe(true)
    }
  })
})
