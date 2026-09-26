import { computed, ref } from 'vue'
import type { TtsVoice } from '@bookorbit/types'
import * as ttsApi from '../api/tts.api'
import type { TtsProviderInfo } from '../api/tts.api'

const allVoices = ref<TtsVoice[]>([])
const providers = ref<TtsProviderInfo[]>([])
const voicesLoading = ref(false)
const voicesError = ref<string | null>(null)
let previewAudio: HTMLAudioElement | null = null

export function useTtsVoices() {
  async function loadVoices(providerId?: string) {
    voicesLoading.value = true
    voicesError.value = null
    try {
      allVoices.value = await ttsApi.getVoices(providerId)
    } catch (err) {
      voicesError.value = err instanceof Error ? err.message : 'Failed to load voices'
    } finally {
      voicesLoading.value = false
    }
  }

  async function loadProviders() {
    try {
      providers.value = await ttsApi.getProviders()
    } catch {
      providers.value = []
    }
  }

  const groupedVoices = computed(() => {
    const groups: Record<string, { language: string; voices: TtsVoice[] }> = {}
    for (const voice of allVoices.value) {
      const lang = voice.language || voice.locale || 'Unknown'
      if (!groups[lang]) groups[lang] = { language: lang, voices: [] }
      groups[lang]!.voices.push(voice)
    }
    return Object.values(groups).sort((a, b) => a.language.localeCompare(b.language))
  })

  function searchVoices(query: string): TtsVoice[] {
    if (!query.trim()) return allVoices.value
    const q = query.toLowerCase()
    return allVoices.value.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.locale.toLowerCase().includes(q) ||
        v.language.toLowerCase().includes(q) ||
        v.providerName.toLowerCase().includes(q),
    )
  }

  async function previewVoice(providerId: string, voiceId: string): Promise<void> {
    if (previewAudio) {
      previewAudio.pause()
      previewAudio = null
    }
    const response = await ttsApi.previewVoice(providerId, voiceId)
    if (!response.ok) throw new Error('Preview failed')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    previewAudio = new Audio(url)
    previewAudio.onended = () => URL.revokeObjectURL(url)
    await previewAudio.play()
  }

  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause()
      previewAudio = null
    }
  }

  return {
    allVoices,
    providers,
    voicesLoading,
    voicesError,
    groupedVoices,
    loadVoices,
    loadProviders,
    searchVoices,
    previewVoice,
    stopPreview,
  }
}
