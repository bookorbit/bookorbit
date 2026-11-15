<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis, Lock } from '@lucide/vue'
import type { JobActionKind, JobListItem } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import AiJobCover from '@/features/ai/components/AiJobCover.vue'
import { formatRelativeTimeFromNow } from '@/i18n/formatters'
import { jobActionLabel, jobActionOnLabel, jobNoteText, jobStatusLabel, jobSubjectLabel, jobTypeLabel } from '../lib/job-copy'
import { JOB_ACTION_ICONS, jobMoment, jobTypeIcon, orderedJobActions } from '../lib/job-presentation'
import JobDetailLine from './JobDetailLine.vue'
import JobStatusBadge from './JobStatusBadge.vue'

const props = defineProps<{
  item: JobListItem
  selected: boolean
  /** Shown when listing everyone's jobs. */
  showRequester: boolean
  /** Shown to those who manage the server's settings. */
  showCost: boolean
  /** Needs you and Failed lead with one labelled button; elsewhere actions stay icons. */
  labelFirst: boolean
  busy: boolean
}>()

const emit = defineEmits<{ toggle: [id: string]; act: [action: JobActionKind, item: JobListItem]; note: [text: string] }>()

const { t } = useI18n()

const name = computed(() => jobSubjectLabel(props.item))
const titleTip = computed(() => (props.item.subject.byline ? `${name.value}, ${props.item.subject.byline}` : name.value))
const typeLabel = computed(() => jobTypeLabel(props.item.type))
const typeIcon = computed(() => jobTypeIcon(props.item.type))
const statusLabel = computed(() => jobStatusLabel(props.item.status))
const actions = computed(() => orderedJobActions(props.item.actions))
const lead = computed(() => actions.value[0] ?? null)
/** At most two buttons in a row; the rest wait in a menu, Cancel last and set apart. */
const inline = computed(() => (props.labelFirst || actions.value.length <= 2 ? actions.value.slice(1) : []))
const menu = computed(() => (props.labelFirst || actions.value.length <= 2 ? [] : actions.value.slice(1)))
const menuPlain = computed(() => menu.value.filter((action) => action !== 'cancel'))
const menuCancels = computed(() => menu.value.includes('cancel'))
const noteText = computed(() => (actions.value.length === 0 && props.item.actionNote ? jobNoteText(props.item.actionNote) : null))
const requesterText = computed(() => props.item.requester?.name ?? t('aiArea.activity.deletedAccountName'))
const moment = computed(() => jobMoment(props.item))
const momentText = computed(() => formatRelativeTimeFromNow(moment.value.at, { smallestUnit: 'minute' }))
const momentTip = computed(() => t(`aiArea.activity.times.${moment.value.kind}`, { time: momentText.value }))
const rowClass = computed(() => {
  if (props.selected) return 'bg-primary/9'
  if (props.item.status === 'running') return 'bg-primary/4'
  return 'hover:bg-muted/30'
})

function handleToggle() {
  emit('toggle', props.item.id)
}

function handleAction(action: JobActionKind) {
  emit('act', action, props.item)
}

function handleLead() {
  if (lead.value) emit('act', lead.value, props.item)
}

function handleCancel() {
  emit('act', 'cancel', props.item)
}

function handleNote() {
  if (noteText.value) emit('note', noteText.value)
}
</script>

<template>
  <tr class="transition-colors motion-reduce:transition-none" :class="rowClass" data-testid="job-row" :data-job-id="item.id">
    <td class="h-[41px] w-px border-t border-border ps-4 pe-3 align-middle @max-4xl/jobs:h-[60px] @max-4xl/jobs:ps-3 @max-4xl/jobs:pe-2">
      <input
        type="checkbox"
        class="block size-4 rounded-xs accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :checked="selected"
        :aria-label="t('aiArea.activity.select', { name })"
        data-testid="job-select"
        @change="handleToggle"
      />
    </td>
    <td class="w-full max-w-0 border-t border-border pe-3.5 align-middle @max-4xl/jobs:pe-2.5">
      <div class="flex min-w-0 items-center gap-3">
        <span class="relative shrink-0">
          <AiJobCover
            :src="item.subject.image"
            class="h-7 w-5 rounded-[3px] @max-4xl/jobs:h-9 @max-4xl/jobs:w-6 @max-4xl/jobs:rounded"
            :icon-size="11"
          />
          <span
            class="absolute -end-[5px] -bottom-1 grid size-4 place-items-center rounded-full border border-border bg-card text-foreground @4xl/jobs:hidden"
            aria-hidden="true"
          >
            <component :is="typeIcon" class="size-2.5" />
          </span>
        </span>
        <!-- A byline never shows half: when it does not fit beside the title it wraps onto a hidden second line. -->
        <div
          class="flex h-5 min-w-0 flex-wrap items-baseline gap-x-2 overflow-hidden @max-4xl/jobs:grid @max-4xl/jobs:h-auto @max-4xl/jobs:gap-1.5 @max-4xl/jobs:overflow-visible"
        >
          <RouterLink
            v-if="item.subject.url"
            :to="item.subject.url"
            class="min-w-0 truncate rounded-[3px] text-sm leading-5 font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :title="titleTip"
            data-testid="job-title"
          >
            {{ name }}
          </RouterLink>
          <span v-else class="min-w-0 truncate text-sm leading-5 font-medium text-foreground" :title="titleTip" data-testid="job-title">{{
            name
          }}</span>
          <span v-if="item.subject.byline" class="flex-none text-[13px] text-muted-foreground @max-4xl/jobs:hidden">{{ item.subject.byline }}</span>
          <JobDetailLine class="@4xl/jobs:hidden" :item="item" compact :show-cost="false" />
          <span class="sr-only @4xl/jobs:hidden">{{ typeLabel }}, {{ statusLabel }}</span>
        </div>
      </div>
    </td>
    <td class="border-t border-border pe-3.5 align-middle whitespace-nowrap @max-6xl/jobs:hidden">
      <span class="inline-flex items-center gap-[7px] text-[13px] text-foreground">
        <component :is="typeIcon" class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {{ typeLabel }}
      </span>
    </td>
    <td class="border-t border-border pe-3.5 align-middle whitespace-nowrap @max-4xl/jobs:hidden">
      <JobStatusBadge :status="item.status" />
    </td>
    <td class="border-t border-border pe-3.5 align-middle whitespace-nowrap @max-4xl/jobs:hidden">
      <JobDetailLine :item="item" :compact="false" :show-cost="showCost" />
    </td>
    <td
      v-if="showRequester"
      class="border-t border-border pe-3.5 align-middle text-[13px] whitespace-nowrap text-foreground @max-6xl/jobs:hidden"
      data-testid="job-requester"
    >
      {{ requesterText }}
    </td>
    <td
      class="border-t border-border pe-3.5 align-middle text-[13px] whitespace-nowrap text-muted-foreground tabular-nums @max-5xl/jobs:hidden"
      :title="momentTip"
    >
      {{ momentText }}
    </td>
    <td class="w-px border-t border-border pe-3 align-middle">
      <div class="flex items-center justify-end gap-1">
        <template v-if="lead">
          <Button
            v-if="labelFirst"
            variant="outline"
            class="h-8 gap-1.5 px-2.5 @max-4xl/jobs:size-8 @max-4xl/jobs:px-0"
            :disabled="busy"
            :aria-label="jobActionOnLabel(lead, name)"
            :data-testid="`job-action-${lead}`"
            @click="handleLead"
          >
            <component :is="JOB_ACTION_ICONS[lead]" class="size-4" aria-hidden="true" />
            <span class="@max-4xl/jobs:sr-only">{{ jobActionLabel(lead) }}</span>
          </Button>
          <Button
            v-else
            variant="ghost"
            size="icon"
            class="size-8"
            :class="lead === 'cancel' ? 'text-destructive hover:text-destructive' : undefined"
            :disabled="busy"
            :aria-label="jobActionOnLabel(lead, name)"
            :title="jobActionLabel(lead)"
            :data-testid="`job-action-${lead}`"
            @click="handleLead"
          >
            <component :is="JOB_ACTION_ICONS[lead]" class="size-4" aria-hidden="true" />
          </Button>
        </template>
        <Button
          v-for="action in inline"
          :key="action"
          variant="ghost"
          size="icon"
          class="size-8"
          :class="action === 'cancel' ? 'text-destructive hover:text-destructive' : undefined"
          :disabled="busy"
          :aria-label="jobActionOnLabel(action, name)"
          :title="jobActionLabel(action)"
          :data-testid="`job-action-${action}`"
          @click="handleAction(action)"
        >
          <component :is="JOB_ACTION_ICONS[action]" class="size-4" aria-hidden="true" />
        </Button>
        <DropdownMenu v-if="menu.length > 0">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              :disabled="busy"
              :aria-label="t('jobsArea.moreActions', { name })"
              :title="t('jobsArea.moreActionsShort')"
              data-testid="job-more"
            >
              <Ellipsis class="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-60">
            <DropdownMenuItem
              v-for="action in menuPlain"
              :key="action"
              class="gap-2.5"
              :data-testid="`job-menu-${action}`"
              @select="handleAction(action)"
            >
              <component :is="JOB_ACTION_ICONS[action]" class="size-4 text-muted-foreground" aria-hidden="true" />
              {{ jobActionLabel(action) }}
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="menuCancels && menuPlain.length > 0" />
            <DropdownMenuItem
              v-if="menuCancels"
              class="gap-2.5 text-destructive focus:text-destructive"
              data-testid="job-menu-cancel"
              @select="handleCancel"
            >
              <component :is="JOB_ACTION_ICONS.cancel" class="size-4 text-destructive" aria-hidden="true" />
              {{ jobActionLabel('cancel') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          v-if="noteText"
          type="button"
          class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t('jobsArea.whyLocked', { name })"
          :title="noteText"
          data-testid="job-note"
          @click="handleNote"
        >
          <Lock class="size-[15px]" aria-hidden="true" />
        </button>
      </div>
    </td>
  </tr>
</template>
