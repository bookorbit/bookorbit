import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadwiseSettings, ReadwiseTokenValidationResult, UpsertReadwiseSettingsPayload } from '@bookorbit/types'

vi.mock('../../api/readwise.api', () => ({
  fetchReadwiseSettings: vi.fn<() => Promise<ReadwiseSettings>>(),
  upsertReadwiseSettings: vi.fn<(payload: UpsertReadwiseSettingsPayload) => Promise<ReadwiseSettings>>(),
  validateReadwiseToken: vi.fn<(token?: string) => Promise<ReadwiseTokenValidationResult>>(),
}))

import { fetchReadwiseSettings, upsertReadwiseSettings, validateReadwiseToken } from '../../api/readwise.api'

const mockFetchSettings = vi.mocked(fetchReadwiseSettings)
const mockUpsert = vi.mocked(upsertReadwiseSettings)
const mockValidate = vi.mocked(validateReadwiseToken)

const SETTINGS: ReadwiseSettings = {
  tokenConfigured: true,
  enabled: true,
  effectiveEnabled: true,
  disabledReason: null,
  lastSyncedAt: null,
}

async function loadComposable() {
  const { useReadwiseSettings } = await import('../useReadwiseSettings')
  return useReadwiseSettings()
}

describe('useReadwiseSettings', () => {
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

  it('saveSettings updates settings and returns true on success', async () => {
    const payload: UpsertReadwiseSettingsPayload = { apiToken: 'tok', enabled: true }
    mockUpsert.mockResolvedValue(SETTINGS)
    const c = await loadComposable()
    const ok = await c.saveSettings(payload)
    expect(ok).toBe(true)
    expect(c.settings.value).toEqual(SETTINGS)
    expect(c.saving.value).toBe(false)
    expect(c.error.value).toBeNull()
  })

  it('saveSettings sets error and returns false on failure', async () => {
    mockUpsert.mockRejectedValue(new Error('Bad token'))
    const c = await loadComposable()
    const ok = await c.saveSettings({ apiToken: 'bad' })
    expect(ok).toBe(false)
    expect(c.error.value).toBe('Bad token')
    expect(c.saving.value).toBe(false)
  })

  it('validateToken returns valid true on success', async () => {
    const result: ReadwiseTokenValidationResult = { valid: true }
    mockValidate.mockResolvedValue(result)
    const c = await loadComposable()
    const r = await c.validateToken('tok')
    expect(r.valid).toBe(true)
    expect(c.validating.value).toBe(false)
  })

  it('validateToken returns valid false on error', async () => {
    mockValidate.mockRejectedValue(new Error('Unauthorized'))
    const c = await loadComposable()
    const r = await c.validateToken()
    expect(r.valid).toBe(false)
    expect(c.validating.value).toBe(false)
  })
})
