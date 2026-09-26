<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Loader2, Save } from '@lucide/vue'
import { useTtsPreferences } from './composables/useTtsPreferences'
import { useTtsVoices } from './composables/useTtsVoices'
import TtsVoicePicker from './components/TtsVoicePicker.vue'
import TtsSpeedControl from './components/TtsSpeedControl.vue'
import { formatVoiceDisplayName, formatVoiceLocaleLabel } from './lib/voice-display'

const { t } = useI18n()
const { userPrefs, loadUserPreferences, saveUserPreferences } = useTtsPreferences()
const { allVoices, loadProviders, loadVoices } = useTtsVoices()

const selectedProviderId = ref<string | null>(null)
const selectedVoiceId = ref<string | null>(null)
const selectedSpeed = ref(1.0)
const saving = ref(false)
const showVoicePicker = ref(false)
const selectedVoice = computed(() => {
  const voiceId = selectedVoiceId.value
  if (!voiceId) return null
  return (
    allVoices.value.find((voice) => voice.id === voiceId && (!selectedProviderId.value || voice.providerId === selectedProviderId.value)) ??
    allVoices.value.find((voice) => voice.id === voiceId)
  )
})
const selectedVoiceLabel = computed(() => {
  if (!selectedVoice.value) return selectedVoiceId.value
  return formatVoiceDisplayName(selectedVoice.value)
})
const selectedVoiceLocaleLabel = computed(() => {
  if (!selectedVoice.value) return null
  const localeLabel = formatVoiceLocaleLabel(selectedVoice.value)
  return [localeLabel, selectedVoice.value.gender].filter(Boolean).join(' · ')
})

onMounted(async () => {
  await Promise.all([loadUserPreferences(), loadProviders(), loadVoices()])
  if (userPrefs.value) {
    selectedProviderId.value = userPrefs.value.providerId
    selectedVoiceId.value = userPrefs.value.voiceId
    selectedSpeed.value = userPrefs.value.speed ?? 1.0
  }
})

async function handleSave() {
  saving.value = true
  try {
    await saveUserPreferences({
      providerId: selectedProviderId.value ?? undefined,
      voiceId: selectedVoiceId.value ?? undefined,
      speed: selectedSpeed.value,
    })
    toast.success(t('tts.settings.saved'))
  } catch {
    toast.error(t('tts.settings.saveFailed'))
  } finally {
    saving.value = false
  }
}

function handleVoiceSelected(voiceId: string) {
  selectedVoiceId.value = voiceId
  showVoicePicker.value = false
}

function handleProviderSelected(providerId: string) {
  selectedProviderId.value = providerId
}

function handleSpeedUpdate(speed: number) {
  selectedSpeed.value = speed
}

function handleCloseVoicePicker() {
  showVoicePicker.value = false
}

function handleToggleVoicePicker() {
  showVoicePicker.value = !showVoicePicker.value
}
</script>

<template>
  <div class="space-y-4 max-w-2xl">
    <div>
      <p class="text-sm text-muted-foreground mt-1">{{ t('tts.settings.description') }}</p>
    </div>

    <div class="bg-card border border-border rounded-xl p-5 space-y-5">
      <div>
        <label id="tts-default-voice-label" class="block text-sm font-medium text-foreground mb-1">{{ t('tts.settings.defaultVoice') }}</label>
        <button
          class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-accent text-sm"
          aria-labelledby="tts-default-voice-label"
          :aria-expanded="showVoicePicker"
          @click="handleToggleVoicePicker"
        >
          <div class="min-w-0 text-left">
            <div v-if="selectedVoiceLabel" class="text-foreground truncate">{{ selectedVoiceLabel }}</div>
            <div v-else class="text-muted-foreground">{{ t('tts.settings.selectVoice') }}</div>
            <div v-if="selectedVoiceLocaleLabel" class="text-xs text-muted-foreground truncate mt-0.5">
              {{ selectedVoiceLocaleLabel }}
            </div>
          </div>
          <span class="text-muted-foreground text-xs">{{ showVoicePicker ? t('common.hide') : t('tts.settings.change') }}</span>
        </button>
        <div v-if="showVoicePicker" class="mt-2 border border-border rounded-xl overflow-hidden">
          <TtsVoicePicker
            :selected-provider-id="selectedProviderId"
            :selected-voice-id="selectedVoiceId"
            @update:selected-voice-id="handleVoiceSelected"
            @update:selected-provider-id="handleProviderSelected"
            @close="handleCloseVoicePicker"
          />
        </div>
      </div>

      <div>
        <p class="block text-sm font-medium text-foreground mb-3">{{ t('tts.settings.defaultSpeed') }}</p>
        <TtsSpeedControl :speed="selectedSpeed" @update:speed="handleSpeedUpdate" />
      </div>

      <div class="flex justify-end">
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          :disabled="saving"
          @click="handleSave"
        >
          <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
          <Save v-else class="w-4 h-4" />
          {{ t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
