<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileCheck, FileX } from '@lucide/vue'
import type { BookDetail } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatRelativeFromNow } from '@/i18n/formatters'

const props = defineProps<{ book: BookDetail }>()

const { t } = useI18n()

const primaryFile = computed(() => props.book.files.find((file) => file.role === 'primary') ?? props.book.files[0] ?? null)
const otherFiles = computed(() => props.book.files.filter((file) => file !== primaryFile.value))
const writeStatus = computed(() => props.book.fileWriteStatus ?? null)
const writeEnabled = computed(() => writeStatus.value?.enabled === true)
const writableFieldCount = computed(() => writeStatus.value?.writableFields?.length ?? 0)
const lastWritten = computed(() => (props.book.lastWrittenAt ? formatRelativeFromNow(new Date(props.book.lastWrittenAt)) : null))

function formatLabel(format: string | null): string {
  return format ? format.toUpperCase() : t('book.detail.editMetadata.unknownFormat')
}
</script>

<template>
  <section class="flex flex-col overflow-hidden rounded-xl border border-border bg-card" :aria-label="t('book.detail.editMetadata.sourceCard')">
    <header class="flex h-7 flex-none items-center gap-2 border-b border-border px-2.5">
      <h3 class="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('book.detail.editMetadata.sourceCard') }}</h3>
      <span class="ml-auto text-[10px] font-semibold text-muted-foreground">
        {{ t('book.detail.editMetadata.fileCount', { count: book.files.length }) }}
      </span>
    </header>

    <!-- A two-column grid rather than per-row flex, so every value lines up on the same
         edge no matter how long the label beside it is. -->
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-2.5 py-3 text-xs">
      <dt class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{{ t('book.detail.editMetadata.libraryRow') }}</dt>
      <dd class="truncate text-right font-medium" :title="book.libraryName">{{ book.libraryName }}</dd>

      <template v-if="primaryFile">
        <dt class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{{ t('book.detail.editMetadata.primaryRow') }}</dt>
        <dd class="flex min-w-0 items-center justify-end gap-1.5">
          <span class="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary">
            {{ formatLabel(primaryFile.format) }}
          </span>
          <span class="truncate text-muted-foreground">{{ formatBytes(primaryFile.sizeBytes) }}</span>
        </dd>
      </template>

      <dt class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{{ t('book.detail.editMetadata.writeBackRow') }}</dt>
      <dd class="flex min-w-0 items-center justify-end gap-1.5">
        <FileCheck v-if="writeEnabled" class="size-3 shrink-0 text-primary" aria-hidden="true" />
        <FileX v-else class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="truncate font-medium">
          {{ writeEnabled ? t('book.detail.editMetadata.fieldCount', { count: writableFieldCount }) : t('book.detail.editMetadata.writeBackOff') }}
        </span>
      </dd>

      <dt class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{{ t('book.detail.editMetadata.lastWrittenRow') }}</dt>
      <dd class="truncate text-right" :class="lastWritten ? 'font-medium' : 'text-muted-foreground'">
        {{ lastWritten ?? t('book.detail.editMetadata.neverWritten') }}
      </dd>

      <template v-for="file in otherFiles" :key="file.id">
        <dt class="truncate text-[10px] font-semibold tracking-wide text-muted-foreground uppercase" :title="file.filename ?? undefined">
          {{ formatLabel(file.format) }}
        </dt>
        <dd class="truncate text-right text-muted-foreground">{{ formatBytes(file.sizeBytes) }}</dd>
      </template>
    </dl>
  </section>
</template>
