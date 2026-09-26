import { computed, ref } from 'vue'
import type { TtsEffectivePreferences, TtsUserPreferences } from '@bookorbit/types'
import * as ttsApi from '../api/tts.api'

const userPrefs = ref<TtsUserPreferences | null>(null)
const bookPrefsCache = new Map<number, TtsEffectivePreferences>()

export function useTtsPreferences() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadUserPreferences() {
    loading.value = true
    error.value = null
    try {
      userPrefs.value = await ttsApi.getPreferences()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load TTS preferences'
    } finally {
      loading.value = false
    }
  }

  async function saveUserPreferences(prefs: Partial<TtsUserPreferences>) {
    loading.value = true
    error.value = null
    try {
      userPrefs.value = await ttsApi.savePreferences(prefs)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save TTS preferences'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function loadBookPreferences(bookId: number): Promise<TtsEffectivePreferences> {
    const cached = bookPrefsCache.get(bookId)
    if (cached) return cached
    const prefs = await ttsApi.getBookPreferences(bookId)
    bookPrefsCache.set(bookId, prefs)
    return prefs
  }

  async function saveBookPreferences(bookId: number, prefs: { providerId?: string | null; voiceId?: string | null; speed?: number | null }) {
    await ttsApi.saveBookPreferences(bookId, {
      ...(prefs.providerId !== undefined && { providerId: prefs.providerId }),
      ...(prefs.voiceId !== undefined && { voiceId: prefs.voiceId }),
      ...(prefs.speed !== undefined && { speed: prefs.speed }),
    })
    bookPrefsCache.delete(bookId)
  }

  async function deleteBookPreferences(bookId: number) {
    await ttsApi.deleteBookPreferences(bookId)
    bookPrefsCache.delete(bookId)
  }

  const defaultProviderId = computed(() => userPrefs.value?.providerId ?? null)
  const defaultVoiceId = computed(() => userPrefs.value?.voiceId ?? null)
  const defaultSpeed = computed(() => userPrefs.value?.speed ?? 1.0)

  return {
    userPrefs,
    loading,
    error,
    defaultProviderId,
    defaultVoiceId,
    defaultSpeed,
    loadUserPreferences,
    saveUserPreferences,
    loadBookPreferences,
    saveBookPreferences,
    deleteBookPreferences,
  }
}
