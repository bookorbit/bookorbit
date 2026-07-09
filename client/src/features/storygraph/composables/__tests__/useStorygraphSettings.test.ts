import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorygraphCookieValidationResult, StorygraphSettings, UpsertStorygraphSettingsPayload } from '@bookorbit/types'

vi.mock('../../api/storygraph.api', () => ({
  fetchStorygraphSettings: vi.fn<() => Promise<StorygraphSettings>>(),
  upsertStorygraphSettings: vi.fn<(payload: UpsertStorygraphSettingsPayload) => Promise<StorygraphSettings>>(),
  disconnectStorygraph: vi.fn<() => Promise<void>>(),
  validateStorygraphCookies: vi.fn<(sessionCookie?: string, rememberToken?: string) => Promise<StorygraphCookieValidationResult>>(),
}))

import { disconnectStorygraph, fetchStorygraphSettings, upsertStorygraphSettings, validateStorygraphCookies } from '../../api/storygraph.api'

const mockFetchSettings = vi.mocked(fetchStorygraphSettings)
const mockUpsert = vi.mocked(upsertStorygraphSettings)
const mockDisconnect = vi.mocked(disconnectStorygraph)
const mockValidate = vi.mocked(validateStorygraphCookies)

const SETTINGS: StorygraphSettings = {
  cookiesConfigured: true,
  enabled: true,
  effectiveEnabled: true,
  disabledReason: null,
  bookSyncMode: 'all_eligible',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  lastSyncedAt: null,
}

async function loadComposable() {
  const { useStorygraphSettings } = await import('../useStorygraphSettings')
  return useStorygraphSettings()
}

describe('useStorygraphSettings', () => {
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
    const payload: UpsertStorygraphSettingsPayload = {
      sessionCookie: 'sess',
      rememberToken: 'remember',
      enabled: true,
      autoSyncOnStatusChange: true,
      autoSyncOnProgressUpdate: true,
    }
    mockUpsert.mockResolvedValue(SETTINGS)
    const c = await loadComposable()
    const ok = await c.saveSettings(payload)
    expect(ok).toBe(true)
    expect(c.settings.value).toEqual(SETTINGS)
    expect(c.saving.value).toBe(false)
  })

  it('saveSettings returns false on failure', async () => {
    mockUpsert.mockRejectedValue(new Error('Bad cookies'))
    const c = await loadComposable()
    const ok = await c.saveSettings({ sessionCookie: 'bad', rememberToken: 'bad' })
    expect(ok).toBe(false)
    expect(c.error.value).toBe('Bad cookies')
  })

  it('disconnect clears settings', async () => {
    mockDisconnect.mockResolvedValue(undefined)
    mockFetchSettings.mockResolvedValue(SETTINGS)
    const c = await loadComposable()
    await c.fetchSettings()
    await c.disconnect()
    expect(c.settings.value).toBeNull()
  })

  it('validateCookies returns valid true on success', async () => {
    const result: StorygraphCookieValidationResult = { valid: true }
    mockValidate.mockResolvedValue(result)
    const c = await loadComposable()
    const r = await c.validateCookies('sess', 'remember')
    expect(r.valid).toBe(true)
  })

  it('validateCookies returns valid false on error', async () => {
    mockValidate.mockRejectedValue(new Error('Unauthorized'))
    const c = await loadComposable()
    const r = await c.validateCookies('sess', 'remember')
    expect(r.valid).toBe(false)
  })
})
