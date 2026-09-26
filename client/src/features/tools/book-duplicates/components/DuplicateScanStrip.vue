<script setup lang="ts">
import { computed } from 'vue'
import { FolderTree, Info, Loader2, RefreshCw, Search } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateScan } from '@bookorbit/types'
import type { Library } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber, formatRelativeFromNow } from '@/i18n/formatters'

const props = defineProps<{
  libraries: Library[]
  libraryId: string
  similarityPercent: number
  scan: BookDuplicateScan | null
  scanning: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  'update:libraryId': [value: string]
  'update:similarityPercent': [value: number]
  scan: []
}>()

const { t } = useI18n()

const hasResults = computed(() => props.scan?.status === 'completed')
const progressStyle = computed(() => ({ width: `${props.scan?.progressPercent ?? 0}%` }))
const lastRun = computed(() => {
  const completedAt = props.scan?.completedAt
  if (!completedAt || !hasResults.value) return null
  return t('tools.bookDuplicates.scannedBooks', {
    count: formatNumber(props.scan?.totalBooks ?? 0),
    when: formatRelativeFromNow(new Date(completedAt)),
  })
})

function handleLibraryChange(value: string | number): void {
  emit('update:libraryId', String(value))
}

function handleSimilarityChange(value: string | number): void {
  emit('update:similarityPercent', Number(value))
}

function handleScan(): void {
  emit('scan')
}
</script>

<template>
  <section class="flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-card px-2.5 py-2">
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex min-w-0 flex-1 basis-40 items-center gap-1.5 sm:flex-none">
        <span class="sr-only">{{ t('tools.bookDuplicates.scope') }}</span>
        <FolderTree class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Select
          class="h-8 w-full min-w-0 text-[12.5px] sm:w-auto sm:min-w-[10rem]"
          :model-value="libraryId"
          :disabled="scanning"
          @update:model-value="handleLibraryChange"
        >
          <option value="">{{ t('tools.bookDuplicates.allLibraries') }}</option>
          <option v-for="library in libraries" :key="library.id" :value="String(library.id)">{{ library.name }}</option>
        </Select>
      </label>

      <label class="flex shrink-0 items-center gap-1.5">
        <span class="hidden text-[12.5px] whitespace-nowrap text-muted-foreground sm:inline">{{ t('tools.bookDuplicates.similarity') }}</span>
        <Select
          class="h-8 w-auto min-w-[6.5rem] text-[12.5px]"
          :model-value="similarityPercent"
          :disabled="scanning"
          @update:model-value="handleSimilarityChange"
        >
          <option v-for="value in [70, 75, 80, 85, 90, 95, 100]" :key="value" :value="value">
            {{ t('tools.bookDuplicates.similarityOption', { percent: formatNumber(value / 100, { style: 'percent' }) }) }}
          </option>
        </Select>
      </label>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :aria-label="t('tools.bookDuplicates.explainSimilarity')"
          >
            <Info class="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="max-w-sm leading-relaxed">{{ t('tools.bookDuplicates.similarityHelp') }}</TooltipContent>
      </Tooltip>

      <span v-if="lastRun" class="hidden text-[12px] text-muted-foreground sm:inline">{{ lastRun }}</span>

      <Button class="ms-auto h-8 shrink-0" size="sm" :variant="hasResults ? 'outline' : 'default'" :disabled="scanning || busy" @click="handleScan">
        <Loader2 v-if="scanning" class="animate-spin" aria-hidden="true" />
        <RefreshCw v-else-if="hasResults" aria-hidden="true" />
        <Search v-else aria-hidden="true" />
        {{ hasResults ? t('tools.bookDuplicates.rescan') : t('tools.bookDuplicates.runScan') }}
      </Button>
    </div>

    <div v-if="scanning" role="status" aria-live="polite" class="grid gap-1">
      <div class="flex justify-between text-[12px] text-muted-foreground">
        <span>{{ t(`tools.bookDuplicates.status.${scan?.status ?? 'queued'}`) }}</span>
        <span class="tabular-nums">
          {{
            t('tools.bookDuplicates.scanProgress', {
              processed: formatNumber(scan?.processedBooks ?? 0),
              total: formatNumber(scan?.totalBooks ?? 0),
            })
          }}
        </span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" :style="progressStyle" />
      </div>
    </div>
  </section>
</template>
