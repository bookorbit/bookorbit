import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HardcoverSettings, HardcoverTokenValidationResult, UpsertHardcoverSettingsPayload } from '@bookorbit/types'

vi.mock('../../api/hardcover.api', () => ({
  fetchHardcoverSettings: vi.fn<() => Promise<HardcoverSettings>>(),
  upsertHardcoverSettings: vi.fn<(payload: UpsertHardcoverSettingsPayload) => Promise<HardcoverSettings>>(),
  disconnectHardcover: vi.fn<() => Promise<void>>(),
  validateHardcoverToken: vi.fn<(token?: string) => Promise<HardcoverTokenValidationResult>>(),
}))

import { disconnectHardcover, fetchHardcoverSettings, upsertHardcoverSettings, validateHardcoverToken } from '../../api/hardcover.api'

const mockFetchSettings = vi.mocked(fetchHardcoverSettings)
const mockUpsert = vi.mocked(upsertHardcoverSettings)
const mockDisconnect = vi.mocked(disconnectHardcover)
const mockValidate = vi.mocked(validateHardcoverToken)

const SETTINGS: HardcoverSettings = {
  tokenConfigured: true,
  enabled: true,
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  privacySettingId: 3,
  lastSyncedAt: null,
}

async function loadComposable() {
  const { useHardcoverSettings } = await import('../useHardcoverSettings')
  return useHardcoverSettings()
}

describe('useHardcoverSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchSettings populates settings on success', async () => {
    mockFetchSettings.mockResolvedValue(SETTINGS)
    const c = await loadComposable()
    await c.fetchSettings()
    expect(c.settings.value).toEqual(SETTINGS)
    expect(c.loading.value).toBe(false)
    expect(c.error.value).toBeNull()
  })

  it('fetchSettings sets error on failure', async () => {
    mockFetchSettings.mockRejectedValue(new Error('Network error'))
    const c = await loadComposable()
    await c.fetchSettings()
    expect(c.settings.value).toBeNull()
    expect(c.error.value).toBe('Network error')
    expect(c.loading.value).toBe(false)
  })

  it('saveSettings updates settings on success', async () => {
    const payload: UpsertHardcoverSettingsPayload = {
      apiToken: 'tok',
      enabled: true,
      autoSyncOnStatusChange: true,
      autoSyncOnProgressUpdate: true,
      autoSyncOnRatingChange: true,
      privacySettingId: 3,
    }
    mockUpsert.mockResolvedValue(SETTINGS)
    const c = await loadComposable()
    const ok = await c.saveSettings(payload)
    expect(ok).toBe(true)
    expect(c.settings.value).toEqual(SETTINGS)
    expect(c.saving.value).toBe(false)
  })

  it('saveSettings returns false on failure', async () => {
    mockUpsert.mockRejectedValue(new Error('Bad token'))
    const c = await loadComposable()
    const ok = await c.saveSettings({ apiToken: 'bad' })
    expect(ok).toBe(false)
    expect(c.error.value).toBe('Bad token')
  })

  it('disconnect clears settings', async () => {
    mockDisconnect.mockResolvedValue(undefined)
    mockFetchSettings.mockResolvedValue(SETTINGS)
    const c = await loadComposable()
    await c.fetchSettings()
    await c.disconnect()
    expect(c.settings.value).toBeNull()
  })

  it('validateToken returns valid true on success', async () => {
    const result: HardcoverTokenValidationResult = { valid: true, hardcoverUsername: 'alice' }
    mockValidate.mockResolvedValue(result)
    const c = await loadComposable()
    const r = await c.validateToken()
    expect(r.valid).toBe(true)
    expect(r.username).toBe('alice')
  })

  it('validateToken returns valid false on error', async () => {
    mockValidate.mockRejectedValue(new Error('Unauthorized'))
    const c = await loadComposable()
    const r = await c.validateToken()
    expect(r.valid).toBe(false)
  })
})
