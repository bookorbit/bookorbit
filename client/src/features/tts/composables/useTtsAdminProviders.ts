import { computed, ref } from 'vue'
import { requestAudioFocus } from '@/lib/audio-focus'
import * as ttsApi from '../api/tts.api'
import type { StaticVoiceConfig, TtsDbProvider } from '../api/tts.api'
import { parseLanguageCountryFromLocale } from '../lib/voice-display'

export interface TtsAdminVoice {
  id: string
  name: string
  gender: string
  languageName: string
  countryName: string
  /** Language and region combined, used as the grouping heading. */
  groupLabel: string
}

export interface TtsAdminHealth {
  state: 'unknown' | 'ok' | 'error'
  message: string
  voiceCount: number | null
}

export interface TtsAdminProvider {
  key: string
  id: number
  name: string
  baseUrl: string | null
  apiKey: string | null
  defaultModel: string | null
  enabled: boolean
  supportsVoiceDiscovery: boolean
  voices: TtsAdminVoice[]
}

function staticVoiceToAdminVoice(voice: StaticVoiceConfig): TtsAdminVoice {
  const { languageName, countryName } = parseLanguageCountryFromLocale(voice.locale)
  const resolvedLanguage = languageName || voice.language
  return {
    id: voice.id,
    name: voice.name || voice.id,
    gender: voice.gender,
    languageName: resolvedLanguage,
    countryName,
    groupLabel: countryName ? `${resolvedLanguage} · ${countryName}` : resolvedLanguage,
  }
}

export function useTtsAdminProviders() {
  const loading = ref(true)
  const loadFailed = ref(false)
  const providers = ref<TtsDbProvider[]>([])
  const health = ref<Record<string, TtsAdminHealth>>({})
  const testingKey = ref<string | null>(null)
  const deletingKey = ref<string | null>(null)
  const playingVoiceKey = ref<string | null>(null)
  const previewLoadingKey = ref<string | null>(null)

  let previewAudio: HTMLAudioElement | null = null

  // Sorted here rather than trusted from the server because applyOrder rewrites displayOrder
  // locally before the round trip lands.
  const orderedProviders = computed<TtsAdminProvider[]>(() =>
    providers.value
      .map((provider, index) => ({
        order: provider.displayOrder,
        tieBreak: index,
        entry: {
          key: String(provider.id),
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          defaultModel: provider.defaultModel,
          enabled: provider.enabled,
          supportsVoiceDiscovery: provider.supportsVoiceDiscovery,
          voices: (provider.staticVoices ?? []).map(staticVoiceToAdminVoice),
        } satisfies TtsAdminProvider,
      }))
      .sort((a, b) => a.order - b.order || a.tieBreak - b.tieBreak)
      .map((item) => item.entry),
  )

  const enabledCount = computed(() => orderedProviders.value.filter((provider) => provider.enabled).length)

  const curatedVoiceCount = computed(() => orderedProviders.value.reduce((total, provider) => total + provider.voices.length, 0))

  async function load() {
    loading.value = true
    loadFailed.value = false
    try {
      providers.value = await ttsApi.getAdminProviders()
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  async function setEnabled(provider: TtsAdminProvider, enabled: boolean) {
    const updated = await ttsApi.updateProvider(provider.id, { enabled })
    replaceProvider(updated)
  }

  async function testConnection(provider: TtsAdminProvider) {
    testingKey.value = provider.key
    try {
      const result = await ttsApi.testProvider(provider.id)
      health.value[provider.key] = result.connected
        ? { state: 'ok', message: '', voiceCount: result.voiceCount }
        : { state: 'error', message: result.error ?? '', voiceCount: null }
    } catch (err) {
      health.value[provider.key] = { state: 'error', message: err instanceof Error ? err.message : '', voiceCount: null }
    } finally {
      testingKey.value = null
    }
  }

  async function removeProvider(provider: TtsAdminProvider) {
    deletingKey.value = provider.key
    try {
      await ttsApi.deleteProvider(provider.id)
      providers.value = providers.value.filter((entry) => entry.id !== provider.id)
      delete health.value[provider.key]
    } finally {
      deletingKey.value = null
    }
  }

  /**
   * The server demands a complete ordering, so the whole rendered list is submitted. Local state is
   * moved first and rolled back on failure: the drag has already animated into place, and snapping
   * back only when the write actually fails is less jarring than waiting on the round trip.
   */
  async function applyOrder(keys: string[]) {
    const previousProviders = providers.value

    const nextProviders = [...providers.value]
    keys.forEach((key, index) => {
      const target = nextProviders.findIndex((provider) => String(provider.id) === key)
      if (target !== -1) nextProviders[target] = { ...nextProviders[target]!, displayOrder: index }
    })
    providers.value = nextProviders

    try {
      await ttsApi.reorderProviders(keys)
    } catch (err) {
      providers.value = previousProviders
      throw err
    }
  }

  function voiceKey(provider: TtsAdminProvider, voiceId: string) {
    return `${provider.key}:${voiceId}`
  }

  async function previewVoice(provider: TtsAdminProvider, voiceId: string) {
    const key = voiceKey(provider, voiceId)
    if (playingVoiceKey.value === key) {
      stopPreview()
      return
    }
    stopPreview()
    requestAudioFocus('tts')
    previewLoadingKey.value = key
    try {
      const response = await ttsApi.previewVoice(provider.key, voiceId)
      if (!response.ok) throw new Error(`Preview failed with status ${response.status}`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      previewAudio = audio
      const release = () => {
        URL.revokeObjectURL(url)
        if (playingVoiceKey.value === key) playingVoiceKey.value = null
        if (previewAudio === audio) previewAudio = null
      }
      audio.onended = release
      audio.onerror = release
      await audio.play()
      playingVoiceKey.value = key
    } finally {
      if (previewLoadingKey.value === key) previewLoadingKey.value = null
    }
  }

  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause()
      previewAudio = null
    }
    playingVoiceKey.value = null
    previewLoadingKey.value = null
  }

  function replaceProvider(updated: TtsDbProvider) {
    const index = providers.value.findIndex((provider) => provider.id === updated.id)
    if (index !== -1) providers.value[index] = updated
    else providers.value = [...providers.value, updated]
  }

  // Focus is claimed but never owned: useTtsPlayer registers the durable 'tts' owner at module
  // scope, so registering here would replace its pause callback and unregister it on unmount.
  function dispose() {
    stopPreview()
  }

  return {
    loading,
    loadFailed,
    providers,
    orderedProviders,
    enabledCount,
    curatedVoiceCount,
    health,
    testingKey,
    deletingKey,
    playingVoiceKey,
    previewLoadingKey,
    load,
    setEnabled,
    testConnection,
    removeProvider,
    applyOrder,
    previewVoice,
    stopPreview,
    voiceKey,
    replaceProvider,
    dispose,
  }
}
