<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Search } from '@lucide/vue'
import type { ChapterLookupQueueState } from '@bookorbit/types'

import { Button } from '@/components/ui/button'

const props = defineProps<{
  lookup: ChapterLookupQueueState | null
  /** Books with an ASIN in the category shown. */
  candidates: number
  selectedCount: number
  canLookUp: boolean
  busy: boolean
}>()

const emit = defineEmits<{ lookUp: []; cancel: []; clearFinished: [] }>()

const { t } = useI18n()

const active = computed(() => Boolean(props.lookup && (props.lookup.queued > 0 || props.lookup.processing)))
const finishedTotal = computed(() => (props.lookup ? Object.values(props.lookup.finished).reduce((sum, count) => sum + count, 0) : 0))
/** Clear keeps the reviews still waiting, so it is only offered while something else finished. */
const clearable = computed(() => (props.lookup ? finishedTotal.value - props.lookup.finished.review : 0))
const actionLabel = computed(() =>
  props.selectedCount > 0
    ? t('tools.chapterHealth.lookup.lookUpSelected', { count: props.selectedCount })
    : t('tools.chapterHealth.lookup.lookUpCategory', { count: props.candidates }),
)
const actionDisabled = computed(() => props.busy || !props.canLookUp || (props.selectedCount === 0 && props.candidates === 0))
const current = computed(() =>
  props.lookup?.processing
    ? t('tools.chapterHealth.lookup.current', { title: props.lookup.processing.title ?? t('tools.chapterHealth.untitled') })
    : null,
)

function handleLookUp(): void {
  emit('lookUp')
}
function handleCancel(): void {
  emit('cancel')
}
function handleClear(): void {
  emit('clearFinished')
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" :aria-label="t('tools.chapterHealth.lookup.title')">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 max-w-2xl space-y-1">
        <h2 class="text-sm font-semibold text-foreground">{{ t('tools.chapterHealth.lookup.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('tools.chapterHealth.lookup.description') }}</p>
      </div>
      <Button v-if="canLookUp" size="sm" :disabled="actionDisabled" @click="handleLookUp">
        <Loader2 v-if="busy" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <Search v-else aria-hidden="true" />
        {{ actionLabel }}
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" role="status">
      <template v-if="active">
        <span class="flex items-center gap-2 text-foreground">
          <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('tools.chapterHealth.lookup.waiting', { count: lookup!.queued }) }}
        </span>
        <span v-if="current" class="min-w-0 truncate text-muted-foreground">{{ current }}</span>
        <Button variant="ghost" size="sm" @click="handleCancel">{{ t('tools.chapterHealth.lookup.stop') }}</Button>
      </template>
      <span v-else class="text-muted-foreground">{{ t('tools.chapterHealth.lookup.idle') }}</span>
      <template v-if="finishedTotal > 0 && lookup">
        <span class="text-muted-foreground">
          {{
            t('tools.chapterHealth.lookup.finished', {
              applied: lookup.finished.applied,
              review: lookup.finished.review,
              notFound: lookup.finished.not_found,
              failed: lookup.finished.failed,
            })
          }}
        </span>
        <Button v-if="clearable > 0" variant="ghost" size="sm" @click="handleClear">{{ t('tools.chapterHealth.lookup.clear') }}</Button>
      </template>
    </div>
  </section>
</template>
