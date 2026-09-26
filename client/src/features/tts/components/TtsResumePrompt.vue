<script setup lang="ts">
import { ref } from 'vue'
import { BookmarkCheck, Play, Trash2, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    chapterIndex: number | null
    clearing?: boolean
  }>(),
  {
    clearing: false,
  },
)
const emit = defineEmits<{ resume: []; playFromHere: []; clearSavedPosition: []; cancel: [] }>()
const confirmClear = ref(false)

const { t } = useI18n()

function handleResume() {
  emit('resume')
}

function handlePlayFromHere() {
  emit('playFromHere')
}

function handleClearSavedPosition() {
  confirmClear.value = false
  emit('clearSavedPosition')
}

function handleRequestClearSavedPosition() {
  confirmClear.value = true
}

function handleCancelClearSavedPosition() {
  confirmClear.value = false
}

function handleCancel() {
  confirmClear.value = false
  emit('cancel')
}
</script>

<template>
  <div class="flex flex-col items-center gap-3 p-4 bg-card border border-border rounded-xl shadow-lg max-w-sm mx-auto">
    <div class="w-full flex items-start justify-between gap-2">
      <div>
        <div class="font-semibold text-foreground">{{ t('tts.resume.title') }}</div>
        <div class="text-sm text-muted-foreground mt-1">
          {{
            props.chapterIndex !== null ? t('tts.resume.descriptionWithChapter', { chapter: props.chapterIndex + 1 }) : t('tts.resume.description')
          }}
        </div>
      </div>
      <button
        class="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        :aria-label="t('tts.resume.dismiss')"
        @click="handleCancel"
      >
        <X class="w-4 h-4" />
      </button>
    </div>
    <div class="flex gap-3 w-full">
      <button
        class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        @click="handleResume"
      >
        <BookmarkCheck class="w-4 h-4" />
        {{ t('tts.resume.resume') }}
      </button>
      <button
        class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
        @click="handlePlayFromHere"
      >
        <Play class="w-4 h-4" />
        {{ t('tts.resume.startHere') }}
      </button>
    </div>
    <div v-if="confirmClear" class="w-full flex gap-2">
      <button
        class="flex-1 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
        @click="handleCancelClearSavedPosition"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        class="flex-1 px-3 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-60"
        :disabled="props.clearing"
        @click="handleClearSavedPosition"
      >
        {{ props.clearing ? t('tts.resume.clearing') : t('tts.resume.confirmClear') }}
      </button>
    </div>
    <button
      v-else
      class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
      @click="handleRequestClearSavedPosition"
    >
      <Trash2 class="w-4 h-4" />
      {{ t('tts.resume.clearSavedPosition') }}
    </button>
  </div>
</template>
