import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/tts.api', () => ({
  getPreferences: vi.fn<() => Promise<unknown>>(),
  savePreferences: vi.fn<() => Promise<unknown>>(),
  getBookPreferences: vi.fn<() => Promise<unknown>>(),
  saveBookPreferences: vi.fn<() => Promise<void>>(),
  deleteBookPreferences: vi.fn<() => Promise<void>>(),
}))

import * as ttsApi from '../api/tts.api'
import { useTtsPreferences } from './useTtsPreferences'

describe('useTtsPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadUserPreferences', () => {
    it('should load and set user preferences', async () => {
      const mockPrefs = { providerId: null, voiceId: 'af_heart', speed: 1.25 }
      vi.mocked(ttsApi.getPreferences).mockResolvedValue(mockPrefs)

      const { loadUserPreferences, userPrefs } = useTtsPreferences()
      await loadUserPreferences()

      expect(userPrefs.value).toEqual(mockPrefs)
    })

    it('should set error on failure', async () => {
      vi.mocked(ttsApi.getPreferences).mockRejectedValue(new Error('network error'))

      const { loadUserPreferences, error } = useTtsPreferences()
      await loadUserPreferences()

      expect(error.value).toBe('network error')
    })

    it('should set loading false after success', async () => {
      vi.mocked(ttsApi.getPreferences).mockResolvedValue(null)

      const { loadUserPreferences, loading } = useTtsPreferences()
      await loadUserPreferences()

      expect(loading.value).toBe(false)
    })

    it('should set loading false after failure', async () => {
      vi.mocked(ttsApi.getPreferences).mockRejectedValue(new Error('fail'))

      const { loadUserPreferences, loading } = useTtsPreferences()
      await loadUserPreferences()

      expect(loading.value).toBe(false)
    })
  })

  describe('saveUserPreferences', () => {
    it('should save and update userPrefs', async () => {
      const updated = { providerId: '1', voiceId: 'af_heart', speed: 1.5 }
      vi.mocked(ttsApi.savePreferences).mockResolvedValue(updated)

      const { saveUserPreferences, userPrefs } = useTtsPreferences()
      await saveUserPreferences({ speed: 1.5 })

      expect(userPrefs.value).toEqual(updated)
    })

    it('should throw and set error on failure', async () => {
      vi.mocked(ttsApi.savePreferences).mockRejectedValue(new Error('save failed'))

      const { saveUserPreferences, error } = useTtsPreferences()
      await expect(saveUserPreferences({ speed: 1.5 })).rejects.toThrow('save failed')
      expect(error.value).toBe('save failed')
    })
  })

  describe('computed defaults', () => {
    it('defaultProviderId returns null after loading null prefs', async () => {
      vi.mocked(ttsApi.getPreferences).mockResolvedValue(null)
      const { loadUserPreferences, defaultProviderId } = useTtsPreferences()
      await loadUserPreferences()
      expect(defaultProviderId.value).toBeNull()
    })

    it('defaultSpeed returns 1.0 after loading null prefs', async () => {
      vi.mocked(ttsApi.getPreferences).mockResolvedValue(null)
      const { loadUserPreferences, defaultSpeed } = useTtsPreferences()
      await loadUserPreferences()
      expect(defaultSpeed.value).toBe(1.0)
    })

    it('defaultProviderId reflects loaded provider', async () => {
      vi.mocked(ttsApi.getPreferences).mockResolvedValue({ providerId: '1', voiceId: null, speed: 1.0 })
      const { loadUserPreferences, defaultProviderId } = useTtsPreferences()
      await loadUserPreferences()
      expect(defaultProviderId.value).toBe('1')
    })
  })

  describe('loadBookPreferences', () => {
    it('should fetch and cache book preferences', async () => {
      const bookPrefs = { providerId: null, voiceId: 'book-voice', speed: 1.0, isBookOverride: true }
      vi.mocked(ttsApi.getBookPreferences).mockResolvedValue(bookPrefs)

      const { loadBookPreferences } = useTtsPreferences()
      const result = await loadBookPreferences(1)

      expect(result).toEqual(bookPrefs)
      expect(ttsApi.getBookPreferences).toHaveBeenCalledTimes(1)

      // second call should use cache
      await loadBookPreferences(1)
      expect(ttsApi.getBookPreferences).toHaveBeenCalledTimes(1)
    })
  })

  describe('saveBookPreferences', () => {
    it('should save only provided book preference fields', async () => {
      vi.mocked(ttsApi.saveBookPreferences).mockResolvedValue(undefined)

      const { saveBookPreferences } = useTtsPreferences()
      await saveBookPreferences(3, { providerId: '1', voiceId: 'af_heart' })

      expect(ttsApi.saveBookPreferences).toHaveBeenCalledWith(3, {
        providerId: '1',
        voiceId: 'af_heart',
      })
    })
  })

  describe('deleteBookPreferences', () => {
    it('should call API and invalidate cache', async () => {
      vi.mocked(ttsApi.getBookPreferences).mockResolvedValue({ providerId: null, voiceId: null, speed: 1.0, isBookOverride: false })
      vi.mocked(ttsApi.deleteBookPreferences).mockResolvedValue(undefined)

      const { loadBookPreferences, deleteBookPreferences } = useTtsPreferences()
      await loadBookPreferences(5)
      await deleteBookPreferences(5)

      // After delete, next load should fetch again
      await loadBookPreferences(5)
      expect(ttsApi.getBookPreferences).toHaveBeenCalledTimes(2)
    })
  })
})
