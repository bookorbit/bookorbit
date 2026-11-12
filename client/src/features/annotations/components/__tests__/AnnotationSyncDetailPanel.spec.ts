import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationDeviceSyncInfo, AnnotationSyncDetail } from '@bookorbit/types'
import { i18n } from '@/i18n'
import AnnotationSyncDetailPanel from '../AnnotationSyncDetailPanel.vue'

const detail = ref<AnnotationSyncDetail | null>(null)

vi.mock('../../composables/useAnnotationSyncDetail', () => ({
  useAnnotationSyncDetail: () => ({
    detail,
    loading: ref(false),
    retrying: ref(null),
    error: ref(null),
    load: vi.fn<(annotationId: number) => Promise<void>>(),
    retry: vi.fn<(annotationId: number, format: string) => Promise<void>>(),
  }),
}))

function makeDevice(overrides: Partial<AnnotationDeviceSyncInfo>): AnnotationDeviceSyncInfo {
  return {
    source: 'koreader',
    deviceId: 'abcdef1234567890',
    deviceName: null,
    lastAppliedVersion: 3,
    upToDate: true,
    deleteAckedAt: null,
    lastSyncedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('AnnotationSyncDetailPanel', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('names KOReader devices by their given name or model, and falls back to the device id', async () => {
    detail.value = {
      annotationId: 1,
      origin: 'koreader',
      version: 3,
      positions: [],
      devices: [
        makeDevice({ source: 'kobo', deviceId: '7', deviceName: 'Kobo Libra 2', deviceModel: null }),
        makeDevice({ deviceId: 'kobo-1', deviceModel: 'Kobo_io' }),
        makeDevice({ deviceId: 'phone-1', deviceName: 'Pixel', deviceModel: 'husky' }),
        makeDevice({ deviceId: 'abcdef1234567890' }),
      ],
    }

    const wrapper = mount(AnnotationSyncDetailPanel, {
      props: { annotationId: 1 },
      global: { stubs: { Tooltip: true, TooltipContent: true, TooltipTrigger: true } },
    })
    await flushPromises()

    const labels = wrapper.findAll('li span.w-40').map((label) => label.text())
    expect(labels).toEqual(['Kobo Libra 2', 'KOReader · Kobo Libra 2', 'KOReader · Pixel', 'KOReader abcdef12'])
  })
})
