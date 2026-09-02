<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import type { BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'
import { REQUEST_PIPELINE_STEPS, requestPipelineState, requestStepState, type RequestPipelineTone } from '../requestPipeline'

const props = withDefaults(
  defineProps<{
    request: Pick<BookRequestItem, 'status' | 'download'>
    live?: BookRequestProgressEvent | null
    /** The table rendering: five segments, no labels, same state model. */
    compact?: boolean
  }>(),
  { compact: false, live: null },
)

const { t } = useI18n()

/** Semantic, not decorative: a halted request has to read as halted without the label. */
const TONE_CLASS: Record<RequestPipelineTone, string> = {
  waiting: 'text-warning',
  progress: 'text-info',
  done: 'text-success',
  failed: 'text-destructive',
  stopped: 'text-muted-foreground',
}

const state = computed(() => requestPipelineState(props.request, props.live))
const toneClass = computed(() => TONE_CLASS[state.value.tone])
const steps = computed(() =>
  REQUEST_PIPELINE_STEPS.map((step, index) => ({
    step,
    index,
    label: t(`bookRequests.pipeline.steps.${step}`),
    state: requestStepState(state.value, index),
  })),
)

const currentLabel = computed(() => steps.value[state.value.currentIndex]?.label ?? '')

/** Colour is never the only carrier, so the whole bar has one sentence behind it. */
const summary = computed(() => {
  if (state.value.tone === 'done') return t('bookRequests.pipeline.summary.done')
  return t(`bookRequests.pipeline.summary.${state.value.tone}`, { step: currentLabel.value })
})
</script>

<template>
  <ol v-if="compact" class="flex items-center gap-0.5" :class="toneClass" :aria-label="summary">
    <li
      v-for="entry in steps"
      :key="entry.step"
      class="h-1 w-3.5 rounded-full"
      :class="[
        entry.state === 'done' && 'bg-current',
        entry.state === 'current' && 'bg-current ring-2 ring-current/25',
        entry.state === 'upcoming' && 'bg-border',
      ]"
    />
  </ol>

  <div v-else class="flex flex-col gap-1.5">
    <ol class="flex items-center" :class="toneClass" :aria-label="t('bookRequests.pipeline.label')">
      <li
        v-for="entry in steps"
        :key="entry.step"
        class="flex items-center"
        :class="entry.index < steps.length - 1 ? 'flex-1' : 'shrink-0'"
        :aria-current="entry.state === 'current' ? 'step' : undefined"
      >
        <span
          class="flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors motion-reduce:transition-none"
          :class="[
            entry.state === 'done' && 'border-current bg-current',
            entry.state === 'current' && 'border-current bg-card ring-4 ring-current/20',
            entry.state === 'upcoming' && 'border-border bg-card',
          ]"
        >
          <Check v-if="entry.state === 'done'" :size="8" :stroke-width="4" class="text-card" aria-hidden="true" />
          <span v-else-if="entry.state === 'current'" class="size-1.5 rounded-full bg-current" />
        </span>
        <span v-if="entry.index < steps.length - 1" class="h-0.5 flex-1" :class="entry.state === 'done' ? 'bg-current' : 'bg-border'" />
      </li>
    </ol>

    <!-- Five labels do not fit a phone, so below sm only the stage in play is named. -->
    <ol class="hidden sm:flex" aria-hidden="true">
      <li
        v-for="entry in steps"
        :key="entry.step"
        class="pe-1 text-[10.5px] leading-tight"
        :class="[
          entry.index < steps.length - 1 ? 'flex-1' : 'shrink-0 pe-0 text-end',
          entry.state === 'current' ? `font-semibold ${toneClass}` : 'text-muted-foreground',
        ]"
      >
        {{ entry.label }}
      </li>
    </ol>

    <p class="text-[11px] font-semibold sm:hidden" :class="toneClass" aria-hidden="true">{{ currentLabel }}</p>

    <p class="sr-only">{{ summary }}</p>
  </div>
</template>
