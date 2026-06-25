import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KoreaderSettings from '../KoreaderSettings.vue'
import type { KoreaderCredentials, KoreaderSyncStatus } from '@bookorbit/types'
import { copyToClipboard } from '@/lib/clipboard'

const koreaderMock = vi.hoisted(() => ({
  credentials: { __v_isRef: true, value: null as KoreaderCredentials | null },
  syncStatus: { __v_isRef: true, value: null as KoreaderSyncStatus | null },
  loading: { __v_isRef: true, value: false },
  fetchSyncStatus: vi.fn<() => Promise<void>>(),
  createCredentials: vi.fn<() => Promise<void>>(),
  updateCredentials: vi.fn<() => Promise<void>>(),
  deleteCredentials: vi.fn<() => Promise<void>>(),
  getSyncUrl: vi.fn<() => string>(),
  downloadPluginPackage: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/features/koreader/composables/useKoreaderSync', () => ({
  useKoreaderSync: () => koreaderMock,
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
}))

vi.mock('../SettingsPageHeader.vue', () => ({
  default: { template: '<div />' },
}))

function makeCredentials(overrides: Partial<KoreaderCredentials> = {}): KoreaderCredentials {
  return {
    username: 'reader-user',
    syncEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeSyncStatus(overrides: Partial<KoreaderSyncStatus> = {}): KoreaderSyncStatus {
  return {
    credentials: makeCredentials(),
    devices: [
      {
        device: 'Kobo Libra 2',
        deviceId: 'device-1',
        lastSyncAt: '2026-01-02T00:00:00.000Z',
        lastBookTitle: 'Project Hail Mary',
      },
    ],
    totalSyncedBooks: 14,
    lastSyncAt: '2026-01-02T00:00:00.000Z',
    latestPluginVersion: '0.5.0',
    pluginUpdateAvailable: true,
    sweeps: [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: '0.3.0',
        latestPluginVersion: '0.5.0',
        updateAvailable: true,
        lastSweepAt: '2026-01-02T00:00:00.000Z',
        lastSweepBooksMatched: 12,
        lastSweepPageStats: 30,
        lastSweepAnnotations: 8,
      },
    ],
    pluginTotals: { matchedBooks: 12, pageStatEvents: 30, annotations: 8, trashedAnnotations: 1, pendingDeletes: 2, failedPositions: 3 },
    ...overrides,
  }
}

function mountComponent() {
  return mount(KoreaderSettings, { props: { embedded: true } })
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text))
}

describe('KoreaderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    koreaderMock.credentials.value = null
    koreaderMock.syncStatus.value = null
    koreaderMock.loading.value = false
    koreaderMock.fetchSyncStatus.mockResolvedValue(undefined)
    koreaderMock.createCredentials.mockResolvedValue(undefined)
    koreaderMock.updateCredentials.mockResolvedValue(undefined)
    koreaderMock.deleteCredentials.mockResolvedValue(undefined)
    koreaderMock.getSyncUrl.mockReturnValue('https://bookorbit.example/api/v1/koreader')
    koreaderMock.downloadPluginPackage.mockResolvedValue(undefined)
  })

  it('shows loading state', () => {
    koreaderMock.loading.value = true

    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('Loading KOReader settings...')
  })

  it('shows an error when status loading fails', async () => {
    koreaderMock.fetchSyncStatus.mockRejectedValue(new Error('Failed to load status'))

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load status')
  })

  it('keeps the unconfigured state focused on credential creation', async () => {
    koreaderMock.syncStatus.value = makeSyncStatus({ credentials: null, devices: [], totalSyncedBooks: 0, lastSyncAt: null, sweeps: [] })

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('KOReader sync is not configured')
    expect(wrapper.text()).toContain('Create credentials')
    expect(wrapper.text()).not.toContain('Setup Guide')

    await buttonByText(wrapper, 'Create credentials')!.trigger('click')
    await wrapper.find('input[type="text"]').setValue('new-reader')
    await wrapper.find('input[type="password"]').setValue('secret1')
    await buttonByText(wrapper, 'Create')!.trigger('click')

    expect(koreaderMock.createCredentials).toHaveBeenCalledWith({ username: 'new-reader', password: 'secret1' })
  })

  it('renders configured status, setup, device, activity, guide, and danger sections', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.findAll('.settings-group-label').map((label) => label.text())).toEqual([
      'KOReader Status',
      'Setup',
      'Devices',
      'Plugin Activity',
      'Setup Guide',
      'Danger Zone',
    ])
    expect(wrapper.text()).toContain('reader-user')
    expect(wrapper.text()).toContain('14 books')
    expect(wrapper.text()).toContain('1 device')
    const syncUrlInput = wrapper.find('input[readonly]').element as HTMLInputElement
    expect(syncUrlInput.value).toBe('https://bookorbit.example/api/v1/koreader')
    expect(wrapper.text()).toContain('Kobo Libra 2')
    expect(wrapper.text()).toContain('Project Hail Mary')
    expect(wrapper.text()).toContain('Latest plugin: v0.5.0')
    expect(wrapper.text()).toContain('Update available')
    expect(wrapper.text()).toContain('latest plugin v0.5.0')
    expect(wrapper.text()).toContain('Matched books')
    expect(wrapper.text()).toContain('2 deleted highlights awaiting KOReader plugin acknowledgement.')
    expect(wrapper.text()).toContain('3 highlight positions need attention.')
    expect(wrapper.text()).not.toContain('Download the preconfigured plugin above.')
  })

  it('expands the setup guide only when requested', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Download the preconfigured plugin above.')

    await buttonByText(wrapper, 'KOReader setup steps')!.trigger('click')

    expect(wrapper.text()).toContain('Download the preconfigured plugin above.')
  })

  it('shows current plugin state without an update warning when reported devices are current', async () => {
    const status = makeSyncStatus({
      pluginUpdateAvailable: false,
      sweeps: [
        {
          deviceId: 'device-1',
          deviceModel: 'Kobo Libra 2',
          pluginVersion: '0.5.0',
          latestPluginVersion: '0.5.0',
          updateAvailable: false,
          lastSweepAt: '2026-01-02T00:00:00.000Z',
          lastSweepBooksMatched: 12,
          lastSweepPageStats: 30,
          lastSweepAnnotations: 8,
        },
      ],
    })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Latest plugin: v0.5.0')
    expect(wrapper.text()).toContain('Up to date')
    expect(wrapper.text()).not.toContain('latest plugin v0.5.0')
  })

  it('keeps plugin update state explicit when the server cannot report the latest version', async () => {
    const status = makeSyncStatus({
      latestPluginVersion: null,
      pluginUpdateAvailable: false,
      sweeps: [
        {
          deviceId: 'device-1',
          deviceModel: 'Kobo Libra 2',
          pluginVersion: '0.5.0',
          latestPluginVersion: null,
          updateAvailable: null,
          lastSweepAt: '2026-01-02T00:00:00.000Z',
          lastSweepBooksMatched: 12,
          lastSweepPageStats: 30,
          lastSweepAnnotations: 8,
        },
      ],
    })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Latest plugin unavailable')
    expect(wrapper.text()).toContain('Version unknown')
    expect(wrapper.text()).not.toContain('Update available')
  })

  it('calls existing action methods from the refreshed controls', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Refresh')!.trigger('click')
    await wrapper.findComponent({ name: 'ToggleSwitch' }).trigger('click')
    await buttonByText(wrapper, 'Copy URL')!.trigger('click')
    await buttonByText(wrapper, 'Download Plugin')!.trigger('click')
    await buttonByText(wrapper, 'Delete')!.trigger('click')
    await flushPromises()

    expect(koreaderMock.fetchSyncStatus).toHaveBeenCalledTimes(2)
    expect(koreaderMock.updateCredentials).toHaveBeenCalledWith({ syncEnabled: false })
    expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith('https://bookorbit.example/api/v1/koreader')
    expect(koreaderMock.downloadPluginPackage).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Delete KOReader credentials?')

    const deleteButtons = wrapper.findAll('button').filter((button) => button.text() === 'Delete')
    await deleteButtons[deleteButtons.length - 1]!.trigger('click')

    expect(koreaderMock.deleteCredentials).toHaveBeenCalledTimes(1)
  })
})
