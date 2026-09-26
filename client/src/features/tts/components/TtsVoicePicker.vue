<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, Volume2, Loader2, Check } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useTtsVoices } from '../composables/useTtsVoices'
import type { TtsVoice } from '@bookorbit/types'
import { formatVoiceDisplayName, parseVoiceLanguageCountry } from '../lib/voice-display'

const props = withDefaults(
  defineProps<{
    selectedProviderId: string | null
    selectedVoiceId: string | null
    heightClass?: string
  }>(),
  {
    heightClass: 'h-[80vh] max-h-[600px]',
  },
)

const emit = defineEmits<{
  'update:selectedVoiceId': [voiceId: string]
  'update:selectedProviderId': [providerId: string]
  close: []
}>()

const { t } = useI18n()
const { allVoices, providers, voicesLoading, loadVoices, loadProviders, previewVoice } = useTtsVoices()

const searchQuery = ref('')
const activeProviderId = ref(props.selectedProviderId ?? '')
const previewingVoiceId = ref<string | null>(null)
const languageFilter = ref('')
const countryFilter = ref('')

type VoiceListEntry = {
  voice: TtsVoice
  displayName: string
  languageName: string
  countryName: string
  localeLabel: string
}

watch(
  () => props.selectedProviderId,
  (v) => {
    activeProviderId.value = v ?? ''
  },
)

const entries = computed<VoiceListEntry[]>(() =>
  allVoices.value.map((voice) => {
    const parsed = parseVoiceLanguageCountry(voice)
    const languageName = parsed.languageName
    const countryName = parsed.countryName
    return {
      voice,
      displayName: formatVoiceDisplayName(voice),
      languageName,
      countryName,
      localeLabel: countryName ? `${languageName} (${countryName})` : languageName,
    }
  }),
)

const languageOptions = computed(() =>
  [...new Set(entries.value.map((entry) => entry.languageName))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
)

const countryOptions = computed(() => {
  const source = languageFilter.value ? entries.value.filter((entry) => entry.languageName === languageFilter.value) : entries.value
  return [...new Set(source.map((entry) => entry.countryName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
})

watch(countryOptions, (nextCountries) => {
  if (countryFilter.value && !nextCountries.includes(countryFilter.value)) {
    countryFilter.value = ''
  }
})

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return entries.value.filter((entry) => {
    if (activeProviderId.value && entry.voice.providerId !== activeProviderId.value) return false
    if (languageFilter.value && entry.languageName !== languageFilter.value) return false
    if (countryFilter.value && entry.countryName !== countryFilter.value) return false
    if (!q) return true
    return (
      entry.displayName.toLowerCase().includes(q) ||
      entry.languageName.toLowerCase().includes(q) ||
      entry.countryName.toLowerCase().includes(q) ||
      entry.localeLabel.toLowerCase().includes(q) ||
      entry.voice.name.toLowerCase().includes(q) ||
      entry.voice.locale.toLowerCase().includes(q) ||
      entry.voice.providerName.toLowerCase().includes(q)
    )
  })
})

const filteredGroups = computed(() => {
  const groups = new Map<string, VoiceListEntry[]>()
  for (const entry of filteredEntries.value) {
    const key = entry.localeLabel
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(entry)
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })))
})

async function handlePreview(voice: TtsVoice) {
  previewingVoiceId.value = voice.id
  try {
    await previewVoice(voice.providerId, voice.id)
  } finally {
    previewingVoiceId.value = null
  }
}

function handleSelectVoice(voice: TtsVoice) {
  emit('update:selectedVoiceId', voice.id)
  emit('update:selectedProviderId', voice.providerId)
}

function handleSelectProvider(providerId: string) {
  activeProviderId.value = providerId
}

function handleShowAllProviders() {
  handleSelectProvider('')
}

function handleSearchInput(event: Event) {
  searchQuery.value = (event.target as HTMLInputElement).value
}

void loadProviders()
void loadVoices()
</script>

<template>
  <div class="flex flex-col" :class="props.heightClass">
    <div class="p-3 border-b border-border space-y-2.5 bg-muted/10">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          :placeholder="t('tts.voicePicker.search')"
          :aria-label="t('tts.voicePicker.search')"
          class="w-full pl-9 pr-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-shadow"
          :value="searchQuery"
          @input="handleSearchInput"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-1 bg-muted/50 p-1 rounded-md border border-border">
          <button
            class="px-2.5 py-1 rounded text-xs font-medium transition-colors"
            :class="activeProviderId === '' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="activeProviderId === ''"
            @click="handleShowAllProviders"
          >
            {{ t('tts.voicePicker.allProviders') }}
          </button>
          <button
            v-for="provider in providers"
            :key="provider.id"
            class="px-2.5 py-1 rounded text-xs font-medium transition-colors"
            :class="activeProviderId === provider.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="activeProviderId === provider.id"
            @click="handleSelectProvider(provider.id)"
          >
            {{ provider.name }}
          </button>
        </div>
        <div class="flex flex-1 items-center gap-2 min-w-[200px]">
          <select
            v-model="languageFilter"
            :aria-label="t('tts.voicePicker.filterByLanguage')"
            class="flex-1 w-full px-2 py-1.5 text-xs bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">{{ t('tts.voicePicker.allLanguages') }}</option>
            <option v-for="language in languageOptions" :key="language" :value="language">{{ language }}</option>
          </select>
          <select
            v-model="countryFilter"
            :aria-label="t('tts.voicePicker.filterByCountry')"
            class="flex-1 w-full px-2 py-1.5 text-xs bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">{{ t('tts.voicePicker.allCountries') }}</option>
            <option v-for="country in countryOptions" :key="country" :value="country">{{ country }}</option>
          </select>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-4 pb-4 min-h-0 relative">
      <div v-if="voicesLoading" class="flex items-center justify-center py-12">
        <Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
      <div v-else-if="filteredGroups.size === 0" class="text-center py-12 text-muted-foreground text-sm">
        {{ t('tts.voicePicker.empty') }}
      </div>
      <div v-else>
        <div
          v-for="[locale, voices] in filteredGroups"
          :key="locale"
          class="space-y-1 border-b border-border/30 last:border-b-0 pb-1.5 pt-1.5 first:pt-0"
        >
          <div class="sticky top-0 z-10 -mx-4 px-4 py-1 bg-background/95 backdrop-blur-md border-b border-border/50">
            <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ locale }}</span>
          </div>
          <div>
            <div
              v-for="entry in voices"
              :key="entry.voice.id"
              class="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-accent cursor-pointer"
              :class="{ 'bg-accent': props.selectedVoiceId === entry.voice.id }"
              @click="handleSelectVoice(entry.voice)"
            >
              <div class="text-sm font-medium truncate flex-1 min-w-0">{{ entry.displayName }}</div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span v-if="entry.voice.gender" class="text-xs text-muted-foreground">{{ entry.voice.gender }}</span>
                <button
                  type="button"
                  class="p-1.5 rounded-md hover:bg-background text-muted-foreground"
                  :aria-label="t('tts.voicePicker.preview', { name: entry.displayName })"
                  @click.stop="handlePreview(entry.voice)"
                >
                  <Loader2 v-if="previewingVoiceId === entry.voice.id" class="w-4 h-4 animate-spin" />
                  <Volume2 v-else class="w-4 h-4" />
                </button>
                <Check v-if="props.selectedVoiceId === entry.voice.id" class="w-4 h-4 text-primary" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
