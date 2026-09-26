<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, Play } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { TtsAdminVoice } from '../composables/useTtsAdminProviders'

const props = defineProps<{
  voices: TtsAdminVoice[]
  providerKey: string
  playingVoiceKey: string | null
  loadingVoiceKey: string | null
  canPreview: boolean
}>()

const emit = defineEmits<{ preview: [voice: TtsAdminVoice] }>()

const { t } = useI18n()

/**
 * Voices only group once a provider actually spans locales. A single-locale provider would
 * otherwise get one redundant heading above every chip it owns.
 */
const groups = computed(() => {
  const byLabel = new Map<string, TtsAdminVoice[]>()
  for (const voice of props.voices) {
    const label = voice.groupLabel || ''
    const existing = byLabel.get(label)
    if (existing) existing.push(voice)
    else byLabel.set(label, [voice])
  }
  const entries = [...byLabel.entries()].map(([label, voices]) => ({ label, voices }))
  entries.sort((a, b) => a.label.localeCompare(b.label))
  return entries
})

const showHeadings = computed(() => groups.value.length > 1)

function voiceKey(voice: TtsAdminVoice) {
  return `${props.providerKey}:${voice.id}`
}

function isPlaying(voice: TtsAdminVoice) {
  return props.playingVoiceKey === voiceKey(voice)
}

function isLoading(voice: TtsAdminVoice) {
  return props.loadingVoiceKey === voiceKey(voice)
}

function handlePreview(voice: TtsAdminVoice) {
  emit('preview', voice)
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="group in groups" :key="group.label" class="space-y-2">
      <p v-if="showHeadings && group.label" class="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ group.label }}
      </p>
      <ul class="flex flex-wrap gap-2">
        <li v-for="voice in group.voices" :key="voice.id">
          <button
            type="button"
            :disabled="!canPreview"
            :title="canPreview ? undefined : t('settings.admin.tts.previewNeedsEnabled')"
            :aria-label="isPlaying(voice) ? t('settings.admin.tts.previewStop') : t('settings.admin.tts.previewVoice', { name: voice.name })"
            class="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            :class="
              isPlaying(voice)
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-secondary text-foreground enabled:hover:border-primary/40 enabled:hover:bg-accent disabled:opacity-60'
            "
            @click="handlePreview(voice)"
          >
            <Loader2 v-if="isLoading(voice)" class="size-3 shrink-0 animate-spin" />
            <span v-else-if="isPlaying(voice)" class="flex h-3 shrink-0 items-end gap-0.5" aria-hidden="true">
              <span class="eq-bar w-0.5 rounded-full bg-current" style="height: 40%" />
              <span class="eq-bar eq-bar-2 w-0.5 rounded-full bg-current" style="height: 100%" />
              <span class="eq-bar eq-bar-3 w-0.5 rounded-full bg-current" style="height: 65%" />
            </span>
            <Play v-else-if="canPreview" class="size-2.5 shrink-0 fill-current" />
            <span class="font-medium">{{ voice.name }}</span>
            <span v-if="voice.gender" :class="isPlaying(voice) ? 'text-primary-foreground' : 'text-muted-foreground'">
              {{ voice.gender.charAt(0) }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.eq-bar {
  transform-origin: bottom;
  animation: ttsEq 0.9s ease-in-out infinite;
}
.eq-bar-2 {
  animation-delay: 0.15s;
}
.eq-bar-3 {
  animation-delay: 0.3s;
}

@keyframes ttsEq {
  0%,
  100% {
    transform: scaleY(0.4);
  }
  50% {
    transform: scaleY(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .eq-bar {
    animation: none;
  }
}
</style>
