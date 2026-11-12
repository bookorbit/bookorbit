<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, TriangleAlert } from '@lucide/vue'
import type { AiJobListItem, AiJobQueueAction } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { useAiJobDisplay } from '../composables/useAiJobDisplay'
import { aiJobActionLabel, aiJobKindLabel } from '../lib/ai-job-copy'
import { AI_JOB_ACTION_ICONS } from '../lib/ai-job-presentation'
import AiJobCover from './AiJobCover.vue'
import AiJobStatusBadge from './AiJobStatusBadge.vue'

const props = defineProps<{
  item: AiJobListItem
  selected: boolean
  /** Shown when listing everyone's jobs. */
  showRequester: boolean
  /** Shown to those who manage the server's settings. */
  showCost: boolean
  busy: boolean
}>()

const emit = defineEmits<{ toggle: [id: string]; act: [action: AiJobQueueAction, item: AiJobListItem] }>()

const { t } = useI18n()
const { name, reason, phase, progress, progressPercent, progressText, actions, placeText, timeText, requesterText, costText, actionLabel } =
  useAiJobDisplay(() => props.item)

const running = computed(() => props.item.status === 'running')
const position = computed(() => (props.item.status === 'queued' ? props.item.position : null))
const failed = computed(() => props.item.status === 'failed')
const reasonIcon = computed(() => (failed.value ? TriangleAlert : CircleAlert))
const reasonIconClass = computed(() => (failed.value ? 'text-destructive' : 'text-warning'))
/** A plain build is the usual case; only a rebuild or an update is worth naming. */
const kindText = computed(() => (props.item.kind === 'build' ? null : aiJobKindLabel(props.item.kind)))
const rowClass = computed(() => {
  if (props.selected) return 'bg-primary/6'
  if (running.value) return 'bg-primary/4'
  return 'hover:bg-muted/40'
})

function handleToggle() {
  emit('toggle', props.item.id)
}

function handleAction(action: AiJobQueueAction) {
  emit('act', action, props.item)
}
</script>

<template>
  <tr class="border-t border-border transition-colors first:border-t-0" :class="rowClass" data-testid="ai-job-row" :data-job-id="item.id">
    <td class="w-10 min-w-10 py-1.5 ps-3 align-middle">
      <input
        type="checkbox"
        class="size-4 rounded-xs accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :checked="selected"
        :aria-label="t('aiArea.activity.select', { name })"
        data-testid="ai-job-select"
        @change="handleToggle"
      />
    </td>
    <td class="w-8 min-w-8 py-1.5 text-center align-middle text-xs text-muted-foreground tabular-nums max-sm:hidden" data-testid="ai-job-position">
      <template v-if="position !== null">
        <span aria-hidden="true" :class="position === 1 ? 'font-semibold text-primary' : undefined">{{ formatNumber(position) }}</span>
        <span class="sr-only">{{ placeText }}</span>
      </template>
    </td>
    <td class="w-[42%] max-w-0 py-1.5 pe-3 align-middle max-md:w-full">
      <div class="flex min-w-0 items-center gap-2.5">
        <AiJobCover :src="item.subject.image" class="h-7 w-5 rounded-xs" :icon-size="11" />
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-baseline gap-2">
            <RouterLink
              v-if="item.subject.url"
              :to="item.subject.url"
              class="max-w-full shrink-0 truncate text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {{ name }}
            </RouterLink>
            <span v-else class="max-w-full shrink-0 truncate text-sm font-medium text-foreground">{{ name }}</span>
            <span v-if="kindText" class="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-medium text-foreground">{{ kindText }}</span>
            <span v-if="item.subject.byline" class="min-w-0 truncate text-xs text-muted-foreground max-lg:hidden">{{ item.subject.byline }}</span>
          </div>
          <div class="mt-0.5 flex min-w-0 items-center gap-2 xl:hidden">
            <AiJobStatusBadge :status="item.status" class="sm:hidden" />
            <span class="min-w-0 truncate text-xs text-muted-foreground">{{ timeText }}</span>
          </div>
        </div>
      </div>
    </td>
    <td class="py-1.5 pe-3 align-middle whitespace-nowrap max-sm:hidden">
      <AiJobStatusBadge :status="item.status" />
    </td>
    <td class="w-[30%] max-w-0 py-1.5 pe-3 align-middle text-xs max-md:hidden">
      <div v-if="running && (phase || progress !== null)" class="flex min-w-0 items-center gap-2">
        <div
          v-if="progress !== null"
          class="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-valuenow="progressPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('aiArea.activity.progressLabel', { name })"
        >
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <span v-if="progressText" class="shrink-0 text-muted-foreground tabular-nums">{{ progressText }}</span>
        <span v-if="phase" class="min-w-0 truncate text-foreground">{{ phase }}</span>
      </div>
      <p v-else-if="reason" class="flex min-w-0 items-center gap-1.5 text-foreground">
        <component :is="reasonIcon" class="size-3.5 shrink-0" :class="reasonIconClass" aria-hidden="true" />
        <span class="truncate" data-testid="ai-job-reason" :title="reason">{{ reason }}</span>
      </p>
      <span v-else-if="placeText" class="text-foreground">{{ placeText }}</span>
    </td>
    <td class="py-1.5 pe-3 align-middle text-xs whitespace-nowrap text-muted-foreground max-xl:hidden">{{ timeText }}</td>
    <td
      v-if="showRequester"
      class="max-w-36 truncate py-1.5 pe-3 align-middle text-xs text-muted-foreground max-lg:hidden"
      data-testid="ai-job-requester"
    >
      {{ requesterText }}
    </td>
    <td v-if="showCost" class="py-1.5 pe-3 text-end align-middle text-xs whitespace-nowrap text-muted-foreground tabular-nums max-md:hidden">
      {{ costText ?? '' }}
    </td>
    <td class="w-px py-1.5 pe-2 align-middle">
      <div class="flex items-center justify-end gap-0.5">
        <Button
          v-for="action in actions"
          :key="action"
          variant="ghost"
          size="icon"
          class="size-7"
          :class="action === 'cancel' ? 'text-destructive hover:text-destructive' : undefined"
          :disabled="busy"
          :aria-label="actionLabel(action)"
          :title="aiJobActionLabel(action)"
          :data-testid="`ai-job-action-${action}`"
          @click="handleAction(action)"
        >
          <component :is="AI_JOB_ACTION_ICONS[action]" class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </td>
  </tr>
</template>
