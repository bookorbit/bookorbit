import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { KoreaderDeviceSweepInfo } from '@bookorbit/types'
import { useKoreaderFileNamingDrafts } from '../useKoreaderFileNamingDrafts'

function device(overrides: Partial<KoreaderDeviceSweepInfo> = {}): KoreaderDeviceSweepInfo {
  return {
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
    ...overrides,
  }
}

describe('useKoreaderFileNamingDrafts', () => {
  it('treats the displayed account default as inherited rather than a saved override', () => {
    const devices = ref([device()])
    const accountPattern = ref('{authors}/{title}')
    const drafts = useKoreaderFileNamingDrafts(devices, accountPattern)

    expect(drafts.drafts['device-1']?.pattern).toBe('{authors}/{title}')
    expect(drafts.normalizedDeviceDraft('device-1')).toEqual({ pattern: '', seriesPattern: '', standalonePattern: '' })
    expect(drafts.hasSavedOverride('device-1')).toBe(false)
    expect(drafts.hasUnsavedChanges('device-1')).toBe(false)
  })

  it('tracks trimmed device edits and restores the inherited display after clearing', () => {
    const devices = ref([device()])
    const accountPattern = ref('{authors}/{title}')
    const state = useKoreaderFileNamingDrafts(devices, accountPattern)

    state.drafts['device-1']!.seriesPattern = '  {series}/{title}  '

    expect(state.normalizedDeviceDraft('device-1').seriesPattern).toBe('{series}/{title}')
    expect(state.hasUnsavedChanges('device-1')).toBe(true)

    state.clearSaved('device-1')

    expect(state.drafts['device-1']).toEqual({ pattern: '{authors}/{title}', seriesPattern: '', standalonePattern: '' })
    expect(state.hasUnsavedChanges('device-1')).toBe(false)
  })

  it('updates inherited defaults without overwriting dirty specialized patterns', async () => {
    const devices = ref([device(), device({ deviceId: 'device-2', deviceModel: 'Kobo Sage' })])
    const accountPattern = ref('{authors}/{title}')
    const state = useKoreaderFileNamingDrafts(devices, accountPattern)
    state.drafts['device-2']!.seriesPattern = '{series}/{title}'

    accountPattern.value = 'Books/{title}'
    await nextTick()

    expect(state.drafts['device-1']?.pattern).toBe('Books/{title}')
    expect(state.drafts['device-2']).toEqual({
      pattern: 'Books/{title}',
      seriesPattern: '{series}/{title}',
      standalonePattern: '',
    })
  })

  it('updates an inherited default when the device has a saved specialized override', async () => {
    const devices = ref([device({ seriesFileNamingPattern: '{series}/{title}' })])
    const accountPattern = ref('{authors}/{title}')
    const state = useKoreaderFileNamingDrafts(devices, accountPattern)

    accountPattern.value = 'Books/{title}'
    await nextTick()

    expect(state.drafts['device-1']).toEqual({
      pattern: 'Books/{title}',
      seriesPattern: '{series}/{title}',
      standalonePattern: '',
    })
    expect(state.normalizedDeviceDraft('device-1').pattern).toBe('')
  })
})
