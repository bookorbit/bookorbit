<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, CalendarDays, MonitorSmartphone, Plus, RotateCcw, Smartphone } from '@lucide/vue'

const emit = defineEmits<{
  addSession: []
  recordPast: []
}>()

const { t } = useI18n()

const tiles = computed(() => [
  {
    key: 'reader',
    icon: BookOpen,
    title: t('book.detail.readingLog.emptyStage.readerTitle'),
    body: t('book.detail.readingLog.emptyStage.readerBody'),
  },
  {
    key: 'koreader',
    icon: MonitorSmartphone,
    title: t('book.detail.readingLog.emptyStage.koreaderTitle'),
    body: t('book.detail.readingLog.emptyStage.koreaderBody'),
  },
  { key: 'kobo', icon: Smartphone, title: t('book.detail.readingLog.emptyStage.koboTitle'), body: t('book.detail.readingLog.emptyStage.koboBody') },
])

function handleAddSession() {
  emit('addSession')
}

function handleRecordPast() {
  emit('recordPast')
}
</script>

<template>
  <section class="flex min-h-0 flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-8 text-center">
    <span class="inline-flex size-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
      <CalendarDays class="size-5" />
    </span>
    <h2 class="mt-3 text-[15px] font-bold tracking-tight text-foreground">{{ t('book.detail.readingLog.emptyStage.title') }}</h2>
    <p class="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-muted-foreground">{{ t('book.detail.readingLog.emptyStage.description') }}</p>

    <ul class="mt-5 grid w-full max-w-2xl gap-2.5 sm:grid-cols-3">
      <li v-for="tile in tiles" :key="tile.key" class="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left">
        <p class="flex items-center gap-1.5 text-[11.5px] font-bold text-foreground">
          <component :is="tile.icon" class="size-3.5 shrink-0 text-muted-foreground" />
          {{ tile.title }}
        </p>
        <p class="mt-1 text-[11px] leading-snug text-muted-foreground">{{ tile.body }}</p>
      </li>
    </ul>

    <div class="mt-5 flex flex-wrap justify-center gap-2">
      <button
        class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        @click="handleAddSession"
      >
        <Plus class="size-3.5" />
        {{ t('book.detail.readingLog.emptyStage.addSession') }}
      </button>
      <button
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="handleRecordPast"
      >
        <RotateCcw class="size-3.5" />
        {{ t('book.detail.readingLog.emptyStage.recordPast') }}
      </button>
    </div>
  </section>
</template>
