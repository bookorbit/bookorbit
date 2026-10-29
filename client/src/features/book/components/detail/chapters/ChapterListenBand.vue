<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Headphones, Play } from '@lucide/vue'
import { formatPercent } from '@/i18n/formatters'
import { chapterEndMs, indexAtTime, type DraftChapter } from '@/features/book/lib/chapter-edit'
import { formatChapterLength } from '@/features/book/lib/chapter-time'
import ChapterTimeline from './ChapterTimeline.vue'

const props = defineProps<{
  rows: DraftChapter[]
  totalDurationMs: number
  listeningMs: number | null
}>()

const emit = defineEmits<{ listen: [startMs: number] }>()

const { t } = useI18n()

const current = computed(() => {
  if (props.listeningMs === null) return null
  const index = indexAtTime(props.rows, props.listeningMs)
  const row = props.rows[index]
  if (!row) return null
  const end = chapterEndMs(props.rows, index, props.totalDurationMs) ?? props.totalDurationMs
  return { title: row.title, leftMs: Math.max(0, end - props.listeningMs) }
})

function handleListen() {
  emit('listen', props.listeningMs ?? 0)
}
</script>

<template>
  <div class="listen-band flex items-center gap-[18px] border-b border-border px-3.5 pb-2.5 pt-3">
    <div class="listen-lead flex w-[330px] shrink-0 items-center gap-3">
      <button
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        @click="handleListen"
      >
        <Play v-if="current" class="size-3.5 fill-current" aria-hidden="true" />
        <Headphones v-else class="size-3.5" aria-hidden="true" />
        {{ current ? t('book.detail.chapters.listen.resume') : t('book.detail.chapters.listen.start') }}
      </button>
      <div class="flex min-w-0 flex-col gap-[3px]">
        <p class="truncate text-[13px] font-semibold leading-4" :title="current?.title ?? rows[0]?.title">
          {{ current ? current.title : (rows[0]?.title ?? '') }}
        </p>
        <p class="listen-detail truncate text-[11.5px] leading-[14px] text-muted-foreground tabular-nums">
          {{
            current && listeningMs !== null
              ? t('book.detail.chapters.listen.progress', {
                  left: formatChapterLength(current.leftMs),
                  percent: formatPercent(listeningMs / totalDurationMs),
                })
              : t('book.detail.chapters.listen.notStarted')
          }}
        </p>
      </div>
    </div>
    <ChapterTimeline class="min-w-0 flex-1 pt-0.5" :rows="rows" :total-duration-ms="totalDurationMs" mode="listen" :listening-ms="listeningMs" />
  </div>
</template>

<style scoped>
@container chapterstab (max-width: 40rem) {
  .listen-band {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
    padding: 12px;
  }

  .listen-lead {
    width: auto;
  }

  .listen-detail {
    white-space: normal;
  }
}
</style>
