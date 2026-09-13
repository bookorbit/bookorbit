<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import type { SeriesNextBook } from '@bookorbit/types'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const { t } = useI18n()

const props = defineProps<{
  nextBook: SeriesNextBook
  /** Adds the hint that a further page turn opens the next book on its own. */
  autoAdvance?: boolean
}>()

const emit = defineEmits<{
  open: []
}>()

const { coverUrl } = useCoverVersions()

const coverFailed = ref(false)
const coverSrc = computed(() => coverUrl(props.nextBook.bookId, 'thumbnail'))

watch(
  () => props.nextBook.bookId,
  () => {
    coverFailed.value = false
  },
)

const title = computed(() => props.nextBook.title ?? t('reader.cbz.nextIssue.untitled'))
const label = computed(() =>
  props.nextBook.seriesIndex ? t('reader.cbz.nextIssue.numbered', { index: props.nextBook.seriesIndex, title: title.value }) : title.value,
)

function handleCoverError() {
  coverFailed.value = true
}

function handleOpen() {
  emit('open')
}
</script>

<template>
  <div class="flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur-md">
    <img
      v-if="!coverFailed"
      :src="coverSrc"
      alt=""
      class="h-16 w-11 shrink-0 rounded-md border border-border/60 object-cover"
      draggable="false"
      @error="handleCoverError"
    />
    <div class="min-w-0 flex-1">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('reader.cbz.nextIssue.eyebrow') }}</p>
      <p class="truncate text-sm font-medium text-foreground">{{ label }}</p>
      <p v-if="autoAdvance" class="truncate text-xs text-muted-foreground">{{ t('reader.cbz.nextIssue.autoAdvanceHint') }}</p>
    </div>
    <button
      type="button"
      class="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      :aria-label="t('reader.cbz.nextIssue.open', { title: label })"
      @click="handleOpen"
    >
      <span>{{ t('reader.cbz.nextIssue.action') }}</span>
      <ChevronRight :size="15" aria-hidden="true" />
    </button>
  </div>
</template>
