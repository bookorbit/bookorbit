<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Pause, Play, SkipForward, SkipBack, Headphones, Moon, Gauge, Mic2, Loader2, Book, Star } from '@lucide/vue'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import { useTtsPreferences } from '../composables/useTtsPreferences'
import { useTtsVoices } from '../composables/useTtsVoices'
import TtsSpeedControl from './TtsSpeedControl.vue'
import TtsSleepTimerPicker from './TtsSleepTimerPicker.vue'
import TtsVoicePicker from './TtsVoicePicker.vue'
import { formatVoiceDisplayName, formatVoiceLocaleLabel } from '../lib/voice-display'
import CoverFill from '@/features/book/components/CoverFill.vue'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const {
  playbackState,
  currentBook,
  currentBlockIndex,
  currentChapterIndex,
  speed,
  currentProviderId,
  currentVoiceId,
  sleepTimer,
  togglePlayPause,
  nextBlock,
  prevBlock,
  stopPlayback,
  setSpeed,
  setVoice,
} = useTtsPlayer()
const { saveBookPreferences, saveUserPreferences, loadBookPreferences, loadUserPreferences, defaultVoiceId, defaultProviderId } = useTtsPreferences()
const { allVoices, voicesLoading, loadVoices } = useTtsVoices()

const showSpeedControl = ref(false)
const showSleepTimer = ref(false)
const showVoicePicker = ref(false)
const savingBookVoice = ref(false)
const savingDefaultVoice = ref(false)

const currentBookPrefs = ref<{ providerId: string | null; voiceId: string | null } | null>(null)

const selectedVoice = computed(() =>
  allVoices.value.find((voice) => voice.id === currentVoiceId.value && voice.providerId === currentProviderId.value),
)
const selectedVoiceLabel = computed(() => {
  if (!selectedVoice.value) return currentVoiceId.value || t('tts.player.chooseVoice')
  return t('tts.voicePicker.voiceWithLocale', {
    voice: formatVoiceDisplayName(selectedVoice.value),
    locale: formatVoiceLocaleLabel(selectedVoice.value),
  })
})

async function fetchBookPrefs() {
  if (!currentBook.value) return
  try {
    const prefs = await loadBookPreferences(currentBook.value.bookId)
    currentBookPrefs.value = {
      providerId: prefs.providerId,
      voiceId: prefs.voiceId,
    }
  } catch {
    // Ignore error
  }
}

watch(
  () => currentBook.value?.bookId,
  () => {
    void fetchBookPrefs()
  },
  { immediate: true },
)

function isSameProvider(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null)
}

const isBookDefault = computed(() => {
  return (
    !!currentBookPrefs.value &&
    isSameProvider(currentBookPrefs.value.providerId, currentProviderId.value) &&
    currentBookPrefs.value.voiceId === currentVoiceId.value
  )
})

const isGlobalDefault = computed(() => {
  return isSameProvider(defaultProviderId.value, currentProviderId.value) && defaultVoiceId.value === currentVoiceId.value
})

onMounted(() => {
  if (allVoices.value.length === 0) void loadVoices()
  void loadUserPreferences()
})

function handleCollapse() {
  emit('close')
}

function handleStop() {
  stopPlayback()
  emit('close')
}

function handleToggleSpeed() {
  showSpeedControl.value = !showSpeedControl.value
  showSleepTimer.value = false
  showVoicePicker.value = false
}

function handleToggleSleepTimer() {
  showSleepTimer.value = !showSleepTimer.value
  showSpeedControl.value = false
  showVoicePicker.value = false
}

function handleCloseVoicePicker() {
  showVoicePicker.value = false
}

function handleToggleVoicePicker() {
  showVoicePicker.value = !showVoicePicker.value
  showSpeedControl.value = false
  showSleepTimer.value = false
}

function handleVoiceSelected(voiceId: string) {
  const voice = allVoices.value.find((item) => item.id === voiceId)
  if (!voice) return
  setVoice(voice.providerId, voice.id)
}

function handleProviderSelected(providerId: string) {
  const matchingVoice = allVoices.value.find((voice) => voice.providerId === providerId)
  if (matchingVoice && !currentVoiceId.value) {
    setVoice(matchingVoice.providerId, matchingVoice.id)
  }
}

async function handleSaveBookVoice() {
  if (!currentBook.value || !currentProviderId.value || !currentVoiceId.value) return
  savingBookVoice.value = true
  try {
    await saveBookPreferences(currentBook.value.bookId, {
      providerId: currentProviderId.value,
      voiceId: currentVoiceId.value,
    })
    currentBookPrefs.value = {
      providerId: currentProviderId.value,
      voiceId: currentVoiceId.value,
    }
    toast.success(t('tts.player.bookVoiceSaved'))
  } catch {
    toast.error(t('tts.player.bookVoiceSaveFailed'))
  } finally {
    savingBookVoice.value = false
  }
}

async function handleSaveDefaultVoice() {
  if (!currentProviderId.value || !currentVoiceId.value) return
  savingDefaultVoice.value = true
  try {
    await saveUserPreferences({
      providerId: currentProviderId.value,
      voiceId: currentVoiceId.value,
    })
    toast.success(t('tts.player.defaultVoiceSaved'))
  } catch {
    toast.error(t('tts.player.defaultVoiceSaveFailed'))
  } finally {
    savingDefaultVoice.value = false
  }
}
</script>

<template>
  <div class="bg-card border border-border rounded-xl shadow-2xl p-4 space-y-4">
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 w-16 h-20 rounded-lg bg-muted overflow-hidden flex items-center justify-center">
        <CoverFill v-if="currentBook?.coverUrl" :src="currentBook.coverUrl" />
        <Headphones v-else class="w-8 h-8 text-muted-foreground" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-foreground truncate">{{ currentBook?.title ?? t('tts.player.fallbackTitle') }}</div>
        <div class="text-sm text-muted-foreground">{{ currentBook?.author ?? '' }}</div>
        <div class="text-xs text-muted-foreground mt-1">
          {{ t('tts.player.position', { chapter: currentChapterIndex + 1, sentence: currentBlockIndex + 1 }) }}
        </div>
      </div>
      <button class="p-1.5 rounded-md hover:bg-accent text-muted-foreground" :aria-label="t('tts.player.collapsePlayer')" @click="handleCollapse">
        <ChevronDown class="w-5 h-5" />
      </button>
    </div>

    <div class="flex items-center justify-center gap-4 py-1">
      <button
        class="p-2 rounded-lg hover:bg-accent text-foreground disabled:opacity-50"
        :disabled="playbackState === 'loading'"
        :aria-label="t('tts.player.previousSentence')"
        @click="prevBlock"
      >
        <SkipBack class="w-5 h-5" />
      </button>
      <button
        class="p-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 w-12 h-12 flex items-center justify-center"
        :disabled="playbackState === 'loading'"
        :aria-label="playbackState === 'playing' ? t('tts.player.pause') : t('tts.player.play')"
        @click="togglePlayPause"
      >
        <Pause v-if="playbackState === 'playing'" class="w-6 h-6" />
        <Play v-else class="w-6 h-6" />
      </button>
      <button
        class="p-2 rounded-lg hover:bg-accent text-foreground disabled:opacity-50"
        :disabled="playbackState === 'loading'"
        :aria-label="t('tts.player.nextSentence')"
        @click="nextBlock"
      >
        <SkipForward class="w-5 h-5" />
      </button>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <button
        class="flex min-w-0 items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm hover:bg-accent text-foreground border border-transparent"
        :class="{ 'bg-accent border-border': showVoicePicker }"
        @click="handleToggleVoicePicker"
      >
        <Mic2 class="w-4 h-4 flex-shrink-0" />
        <span class="truncate">{{ selectedVoice ? formatVoiceDisplayName(selectedVoice) : t('tts.player.voice') }}</span>
      </button>
      <button
        class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm hover:bg-accent text-foreground border border-transparent"
        :class="{ 'bg-accent border-border': showSpeedControl }"
        @click="handleToggleSpeed"
      >
        <Gauge class="w-4 h-4" />
        <span>{{ t('tts.speed.value', { speed }) }}</span>
      </button>
      <button
        class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm hover:bg-accent text-foreground border border-transparent"
        :class="{ 'bg-accent border-border': showSleepTimer || sleepTimer.activeMinutes.value !== null }"
        @click="handleToggleSleepTimer"
      >
        <Moon class="w-4 h-4" />
        <span v-if="sleepTimer.activeMinutes.value !== null && sleepTimer.remainingSeconds.value !== null">
          {{ t('tts.player.sleepRemaining', { count: Math.ceil(sleepTimer.remainingSeconds.value / 60) }) }}
        </span>
        <span v-else>{{ t('tts.player.sleep') }}</span>
      </button>
    </div>

    <div v-if="showVoicePicker" class="space-y-3 pt-2 border-t border-border">
      <div class="rounded-lg border border-border bg-muted/20 p-2.5 flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-0.5">
            <div class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{ t('tts.player.currentVoice') }}</div>
            <Loader2 v-if="voicesLoading" class="w-3 h-3 animate-spin text-muted-foreground" />
          </div>
          <div class="truncate text-sm font-medium text-foreground">{{ selectedVoiceLabel }}</div>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button
            class="p-1.5 rounded-md border transition-colors disabled:opacity-50"
            :class="
              isBookDefault
                ? 'border-primary/30 text-primary bg-primary/10 hover:bg-primary/20'
                : 'border-border text-muted-foreground bg-background hover:bg-accent hover:text-foreground'
            "
            :title="t('tts.player.saveForBook')"
            :aria-label="t('tts.player.saveForBook')"
            :disabled="savingBookVoice || !currentVoiceId"
            @click="handleSaveBookVoice"
          >
            <Loader2 v-if="savingBookVoice" class="w-4 h-4 animate-spin" />
            <Book v-else class="w-4 h-4" :class="{ 'fill-primary/20': isBookDefault }" />
          </button>
          <button
            class="p-1.5 rounded-md border transition-colors disabled:opacity-50"
            :class="
              isGlobalDefault
                ? 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
                : 'border-border text-muted-foreground bg-background hover:bg-accent hover:text-foreground'
            "
            :title="t('tts.player.setAsDefault')"
            :aria-label="t('tts.player.setAsDefault')"
            :disabled="savingDefaultVoice || !currentVoiceId"
            @click="handleSaveDefaultVoice"
          >
            <Loader2 v-if="savingDefaultVoice" class="w-4 h-4 animate-spin" />
            <Star v-else class="w-4 h-4" :class="{ 'fill-current': isGlobalDefault }" />
          </button>
        </div>
      </div>

      <div class="overflow-hidden rounded-xl border border-border">
        <TtsVoicePicker
          :selected-provider-id="currentProviderId"
          :selected-voice-id="currentVoiceId"
          height-class="h-[min(52vh,360px)]"
          @update:selected-voice-id="handleVoiceSelected"
          @update:selected-provider-id="handleProviderSelected"
          @close="handleCloseVoicePicker"
        />
      </div>
    </div>
    <TtsSpeedControl v-if="showSpeedControl" :speed="speed" @update:speed="setSpeed" />
    <TtsSleepTimerPicker v-if="showSleepTimer" :sleep-timer="sleepTimer" />

    <div class="flex items-center justify-between border-t border-border pt-3">
      <div class="text-xs text-muted-foreground">
        <span class="font-medium text-foreground">{{ t('tts.speed.value', { speed }) }}</span>
        <span> - {{ selectedVoiceLabel }}</span>
      </div>
      <button class="px-3 py-1.5 rounded-lg text-sm hover:bg-accent text-destructive" @click="handleStop">{{ t('tts.player.stop') }}</button>
    </div>
  </div>
</template>
