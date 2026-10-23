import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activateI18nLocale } from '@/i18n'

const toastWarning = vi.hoisted(() => vi.fn<(message: string, options?: unknown) => void>())

vi.mock('vue-sonner', () => ({ toast: { warning: toastWarning } }))

import { cacheFallbackMessage, showCacheFallbackToast } from '../cache-feedback'

function fallback(provider: string) {
  return { provider, source: 'fallback' as const, stale: true, cachedAt: '2026-10-01T00:00:00.000Z' }
}

describe('cache fallback feedback', () => {
  beforeEach(() => {
    activateI18nLocale('en')
    toastWarning.mockReset()
  })

  it('names each unavailable provider once, using the label resolver', () => {
    const message = cacheFallbackMessage([fallback('google'), fallback('google'), fallback('amazon')], (provider) => provider.toUpperCase())
    expect(message).toBe('GOOGLE and AMAZON were unavailable, so saved results were used.')
  })

  it('uses the singular form for one provider', () => {
    expect(cacheFallbackMessage([fallback('goodreads')])).toBe('goodreads was unavailable, so saved results were used.')
  })

  it('shows a warning only when a provider fell back', () => {
    expect(showCacheFallbackToast([])).toBe(false)
    expect(toastWarning).not.toHaveBeenCalled()

    expect(showCacheFallbackToast([fallback('google')])).toBe(true)
    expect(toastWarning).toHaveBeenCalledWith('google was unavailable, so saved results were used.', { closeButton: true })
  })
})
