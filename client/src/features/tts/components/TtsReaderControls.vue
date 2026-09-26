<script setup lang="ts">
import { Headphones } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useTtsPlayer } from '../composables/useTtsPlayer'

const props = defineProps<{
  bookFileId: number
  bookId: number
  title: string
  author: string | null
  coverUrl: string | null
  totalChapters: number
}>()

const emit = defineEmits<{ startTts: [] }>()

const { t } = useI18n()
const { playbackState, currentBook, isActive } = useTtsPlayer()

const isPlayingThisBook = () => isActive.value && currentBook.value?.bookFileId === props.bookFileId

function handleClick() {
  emit('startTts')
}
</script>

<template>
  <button
    class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
    :class="isPlayingThisBook() ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-foreground'"
    @click="handleClick"
  >
    <Headphones class="w-4 h-4" :class="{ 'animate-pulse': isPlayingThisBook() && playbackState === 'playing' }" />
    <span>{{ isPlayingThisBook() ? t('tts.readerControls.playing') : t('tts.readerControls.listen') }}</span>
  </button>
</template>
