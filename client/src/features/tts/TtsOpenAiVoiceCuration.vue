<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { AlertCircle, Loader2, Pencil, Plus, RefreshCw, Square, Trash2, Volume2, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import * as ttsApi from './api/tts.api'
import type { TtsDbProvider, StaticVoiceConfig } from './api/tts.api'
import { detectPreset, mergeVoices, PRESET_VOICES } from './lib/voice-presets'

const props = defineProps<{
  provider: TtsDbProvider
}>()

const emit = defineEmits<{
  save: [voices: StaticVoiceConfig[]]
  close: []
}>()

const { t } = useI18n()

const GENDER_OPTIONS = ['', 'Male', 'Female', 'Unknown'] as const
function genderLabel(gender: string): string {
  if (gender === 'Male') return t('settings.admin.tts.curation.genderMale')
  if (gender === 'Female') return t('settings.admin.tts.curation.genderFemale')
  if (gender === 'Unknown') return t('settings.admin.tts.curation.genderUnknown')
  return '-'
}

const voices = ref<StaticVoiceConfig[]>(props.provider.staticVoices ? [...props.provider.staticVoices] : [])
const savedVoices = ref<StaticVoiceConfig[]>(props.provider.staticVoices ? [...props.provider.staticVoices] : [])

const discovering = ref(false)
const discoverError = ref<string | null>(null)

const editingIdx = ref<number | null>(null)
const editForm = ref<StaticVoiceConfig>({ id: '', name: '', shortName: '', language: '', locale: '', gender: '' })

const saving = ref(false)

const previewingVoiceId = ref<string | null>(null)
const playingVoiceId = ref<string | null>(null)
const previewErrorVoiceId = ref<string | null>(null)
let previewAudio: HTMLAudioElement | null = null
let previewAudioUrl: string | null = null

const presetKey = computed(() => detectPreset(props.provider.defaultModel))

const importDisabledReason = computed<string | null>(() => {
  if (props.provider.supportsVoiceDiscovery) return null
  const presetLabel = presetKey.value === 'kokoro' ? 'Kokoro' : presetKey.value === 'openai' ? 'OpenAI' : null
  return presetLabel
    ? t('settings.admin.tts.curation.importUnsupportedWithPreset', { preset: presetLabel })
    : t('settings.admin.tts.curation.importUnsupported')
})

const emptyStateMessage = computed(() => {
  const canImport = props.provider.supportsVoiceDiscovery
  const hasPreset = !!presetKey.value
  if (canImport && hasPreset) return t('settings.admin.tts.curation.emptyImportOrPreset')
  if (canImport) return t('settings.admin.tts.curation.emptyImport')
  if (hasPreset) return t('settings.admin.tts.curation.emptyPreset')
  return t('settings.admin.tts.curation.emptyManual')
})

const hasUnsavedChanges = computed(() => {
  if (voices.value.length !== savedVoices.value.length) return true
  return voices.value.some((v, i) => {
    const s = savedVoices.value[i]
    return (
      !s ||
      v.id !== s.id ||
      v.name !== s.name ||
      v.shortName !== s.shortName ||
      v.language !== s.language ||
      v.locale !== s.locale ||
      v.gender !== s.gender
    )
  })
})

async function handleDiscover() {
  if (importDisabledReason.value) return
  discovering.value = true
  discoverError.value = null
  try {
    const result = await ttsApi.discoverVoices(props.provider.id)
    if (!result.supported) {
      discoverError.value = t('settings.admin.tts.curation.discoveryUnsupported')
      return
    }
    voices.value = mergeVoices(voices.value, result.voices)
  } catch (e: unknown) {
    discoverError.value = e instanceof Error ? e.message : t('settings.admin.tts.curation.discoverFailed')
  } finally {
    discovering.value = false
  }
}

function handleLoadPreset() {
  if (!presetKey.value) return
  const preset = PRESET_VOICES[presetKey.value]
  voices.value = mergeVoices(voices.value, preset)
}

function handleStartEdit(idx: number) {
  editingIdx.value = idx
  editForm.value = { ...voices.value[idx]! }
}

function handleSaveEdit() {
  if (editingIdx.value === null) return
  const trimmedId = editForm.value.id.trim()
  const trimmedName = editForm.value.name.trim()
  if (!trimmedId || !trimmedName) return
  const duplicate = voices.value.findIndex((v, i) => i !== editingIdx.value && v.id === trimmedId)
  if (duplicate !== -1) return
  voices.value[editingIdx.value] = {
    ...editForm.value,
    id: trimmedId,
    name: trimmedName,
    shortName: editForm.value.shortName.trim() || trimmedId,
  }
  editingIdx.value = null
}

function handleCancelEdit() {
  editingIdx.value = null
}

function handleDeleteVoice(idx: number) {
  voices.value = voices.value.filter((_, i) => i !== idx)
  if (editingIdx.value === idx) editingIdx.value = null
}

async function handleSave() {
  saving.value = true
  try {
    emit('save', [...voices.value])
    savedVoices.value = [...voices.value]
  } finally {
    saving.value = false
  }
}

async function handlePreview(voice: StaticVoiceConfig) {
  if (previewingVoiceId.value === voice.id) return
  if (playingVoiceId.value === voice.id) {
    stopPreview()
    return
  }
  stopPreview()
  previewErrorVoiceId.value = null
  previewingVoiceId.value = voice.id
  try {
    const response = await ttsApi.previewVoice(String(props.provider.id), voice.id)
    if (!response.ok) throw new Error('Preview failed')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    previewAudio = audio
    previewAudioUrl = url
    playingVoiceId.value = voice.id
    audio.onended = () => clearPreviewAudio()
    audio.onpause = () => clearPreviewAudio()
    await audio.play()
  } catch {
    previewErrorVoiceId.value = voice.id
    clearPreviewAudio()
    setTimeout(() => {
      if (previewErrorVoiceId.value === voice.id) previewErrorVoiceId.value = null
    }, 3000)
  } finally {
    previewingVoiceId.value = null
  }
}

function stopPreview() {
  if (previewAudio) previewAudio.pause()
  clearPreviewAudio()
  previewingVoiceId.value = null
  previewErrorVoiceId.value = null
}

function clearPreviewAudio() {
  if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl)
  previewAudio = null
  previewAudioUrl = null
  playingVoiceId.value = null
}

onUnmounted(() => stopPreview())

function handleClose() {
  stopPreview()
  if (hasUnsavedChanges.value && typeof window !== 'undefined') {
    if (!window.confirm('Discard unsaved voice changes?')) return
  }
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <div class="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
      <!-- Header -->
      <div class="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
        <div>
          <h2 class="font-semibold text-foreground">{{ t('settings.admin.tts.curation.title', { provider: provider.name }) }}</h2>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{
              hasUnsavedChanges
                ? t('settings.admin.tts.curation.summaryUnsaved', { count: voices.length })
                : t('settings.admin.tts.curation.summary', { count: voices.length })
            }}
          </p>
        </div>
        <button class="p-1.5 rounded-lg hover:bg-accent" :aria-label="t('common.close')" @click="handleClose">
          <X class="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <!-- Import / preset toolbar -->
      <div class="p-4 border-b border-border flex-shrink-0 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger as-child>
              <span :class="importDisabledReason ? 'cursor-not-allowed' : ''">
                <button
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
                  data-testid="import-from-provider"
                  :disabled="discovering || !!importDisabledReason"
                  @click="handleDiscover"
                >
                  <Loader2 v-if="discovering" class="w-3.5 h-3.5 animate-spin" />
                  <RefreshCw v-else class="w-3.5 h-3.5" />
                  {{ t('settings.admin.tts.curation.importFromProvider') }}
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent v-if="importDisabledReason">{{ importDisabledReason }}</TooltipContent>
          </Tooltip>
          <button
            v-if="presetKey"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent"
            @click="handleLoadPreset"
          >
            <Plus class="w-3.5 h-3.5" />
            {{ t('settings.admin.tts.curation.loadPreset', { preset: presetKey === 'kokoro' ? 'Kokoro' : 'OpenAI' }) }}
          </button>
        </div>
        <p v-if="discoverError" role="alert" class="text-xs text-destructive">{{ discoverError }}</p>
      </div>

      <!-- Voice table -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="voices.length === 0" class="text-sm text-muted-foreground text-center py-10">{{ emptyStateMessage }}</div>
        <template v-else>
          <div class="text-xs border-b border-border bg-muted/50">
            <div class="grid grid-cols-[1fr_1fr_80px_80px_80px] gap-2 px-4 py-2 font-medium text-muted-foreground">
              <div>{{ t('settings.admin.tts.curation.columnId') }}</div>
              <div>{{ t('settings.admin.tts.curation.columnName') }}</div>
              <div>{{ t('settings.admin.tts.curation.columnLocale') }}</div>
              <div>{{ t('settings.admin.tts.curation.columnGender') }}</div>
              <div />
            </div>
          </div>
          <div class="divide-y divide-border">
            <div v-for="(voice, idx) in voices" :key="voice.id">
              <!-- Edit row -->
              <template v-if="editingIdx === idx">
                <div class="grid grid-cols-[1fr_1fr_80px_80px_80px] gap-2 px-4 py-2 items-center">
                  <input
                    v-model="editForm.id"
                    :aria-label="t('settings.admin.tts.curation.columnId')"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    v-model="editForm.name"
                    :aria-label="t('settings.admin.tts.curation.columnName')"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    v-model="editForm.locale"
                    placeholder="en-US"
                    :aria-label="t('settings.admin.tts.curation.columnLocale')"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <select
                    v-model="editForm.gender"
                    :aria-label="t('settings.admin.tts.curation.columnGender')"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option v-for="g in GENDER_OPTIONS" :key="g" :value="g">{{ genderLabel(g) }}</option>
                  </select>
                  <div class="flex items-center gap-1">
                    <button class="p-1 rounded text-primary hover:bg-accent text-xs font-medium" @click="handleSaveEdit">
                      {{ t('common.save') }}
                    </button>
                    <button
                      class="p-1 rounded text-muted-foreground hover:bg-accent text-xs"
                      :aria-label="t('settings.admin.tts.curation.cancelEdit')"
                      @click="handleCancelEdit"
                    >
                      <X class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </template>
              <!-- Display row -->
              <template v-else>
                <div class="grid grid-cols-[1fr_1fr_80px_80px_80px] gap-2 px-4 py-2 items-center hover:bg-accent/20">
                  <span class="text-xs text-muted-foreground font-mono truncate" :title="voice.id">{{ voice.id }}</span>
                  <span class="text-xs text-foreground truncate" :title="voice.name">{{ voice.name }}</span>
                  <span class="text-xs text-muted-foreground">{{ voice.locale || '-' }}</span>
                  <span class="text-xs text-muted-foreground">{{ genderLabel(voice.gender ?? '') }}</span>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                      :aria-label="
                        playingVoiceId === voice.id
                          ? t('settings.admin.tts.curation.stopPreview', { name: voice.name })
                          : t('settings.admin.tts.curation.previewVoice', { name: voice.name })
                      "
                      @click="handlePreview(voice)"
                    >
                      <Loader2 v-if="previewingVoiceId === voice.id" class="w-3.5 h-3.5 animate-spin" />
                      <Square v-else-if="playingVoiceId === voice.id" class="w-3.5 h-3.5" />
                      <AlertCircle v-else-if="previewErrorVoiceId === voice.id" class="w-3.5 h-3.5 text-destructive" />
                      <Volume2 v-else class="w-3.5 h-3.5" />
                    </button>
                    <button
                      class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                      :aria-label="t('settings.admin.tts.curation.editVoice', { name: voice.name })"
                      @click="handleStartEdit(idx)"
                    >
                      <Pencil class="w-3.5 h-3.5" />
                    </button>
                    <button
                      class="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      :aria-label="t('settings.admin.tts.curation.deleteVoice', { name: voice.name })"
                      @click="handleDeleteVoice(idx)"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-3 p-4 border-t border-border flex-shrink-0">
        <button class="px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent" @click="handleClose">
          {{ t('common.cancel') }}
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          :disabled="saving || !hasUnsavedChanges"
          @click="handleSave"
        >
          <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
          {{ t('settings.admin.tts.curation.saveVoices', { count: voices.length }) }}
        </button>
      </div>
    </div>
  </div>
</template>
