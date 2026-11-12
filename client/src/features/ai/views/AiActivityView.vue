<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ChevronLeft, ChevronRight, CircleCheck, History, Sparkles } from '@lucide/vue'
import {
  AI_JOB_LIST_VIEWS,
  Permission,
  type AiJobActionResponse,
  type AiJobListItem,
  type AiJobListView,
  type AiJobQueueAction,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import AiJobTableRow from '../components/AiJobTableRow.vue'
import { AI_JOB_PAGE_SIZE, useAiJobList } from '../composables/useAiJobList'
import { aiJobActionLabel } from '../lib/ai-job-copy'
import { AI_JOB_ACTION_ICONS } from '../lib/ai-job-presentation'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const jobs = useAiJobList()
const {
  view,
  scope,
  offset,
  items,
  total,
  loading,
  failed,
  acting,
  selectedIds,
  selected,
  selectedActions,
  allSelected,
  toggle,
  toggleAll,
  clearSelection,
} = jobs

const manages = computed(() => hasPermission(Permission.ManageAppSettings))
const counts = computed(() => jobs.list.value?.counts ?? null)
const pageEnd = computed(() => Math.min(total.value, offset.value + items.value.length))
const hasPrevious = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + AI_JOB_PAGE_SIZE < total.value)
const showPager = computed(() => total.value > AI_JOB_PAGE_SIZE)
const busy = computed(() => acting.value !== null)
const showingEveryone = computed(() => scope.value === 'all')

const emptyIcon = computed(() => (view.value === 'queue' ? Sparkles : view.value === 'failed' ? CircleCheck : History))

/** Jobs waiting on the Cancel confirmation. */
const cancelling = ref<AiJobListItem[] | null>(null)
const cancelOpen = computed(() => cancelling.value !== null)
const cancelCount = computed(() => cancelling.value?.filter((item) => item.actions.includes('cancel')).length ?? 0)

function viewLabel(entry: AiJobListView): string {
  return t(`aiArea.activity.views.${entry}`)
}

function viewCount(entry: AiJobListView): number | null {
  return counts.value?.[entry] ?? null
}

/** Failed jobs waiting on someone stand out even while another view is open. */
function viewCountClass(entry: AiJobListView): string {
  if (view.value === entry) return 'bg-primary/15 text-primary'
  if (entry === 'failed' && (viewCount(entry) ?? 0) > 0) return 'bg-destructive/12 text-destructive'
  return 'bg-muted text-muted-foreground'
}

function selectView(entry: AiJobListView) {
  view.value = entry
}

function showMine() {
  scope.value = 'mine'
}

function showEveryone() {
  scope.value = 'all'
}

function previousPage() {
  offset.value = Math.max(0, offset.value - AI_JOB_PAGE_SIZE)
}

function nextPage() {
  offset.value += AI_JOB_PAGE_SIZE
}

function retryLoad() {
  void jobs.load()
}

function report(action: AiJobQueueAction, response: AiJobActionResponse) {
  const done = response.results.filter((result) => result.outcome === 'done').length
  const stillPaused = response.results.filter((result) => result.outcome === 'still-paused').length
  const other = response.results.length - done - stillPaused
  if (done > 0) toast.success(t(`aiArea.activity.results.${action}`, { count: done }))
  if (stillPaused > 0) toast.info(t('aiArea.activity.results.stillPaused', { count: stillPaused }))
  if (other > 0) toast.warning(t('aiArea.activity.results.unchanged', { count: other }))
}

async function run(action: AiJobQueueAction, targets: readonly AiJobListItem[]) {
  try {
    const response = await jobs.act(action, targets)
    if (response) report(action, response)
  } catch (reason) {
    toast.error(errorMessage(reason, 'aiArea.activity.actionFailed'))
  }
}

function request(action: AiJobQueueAction, targets: readonly AiJobListItem[]) {
  if (action === 'cancel') {
    cancelling.value = [...targets]
    return
  }
  void run(action, targets)
}

function handleItemAction(action: AiJobQueueAction, item: AiJobListItem) {
  request(action, [item])
}

function handleBulkAction(action: AiJobQueueAction) {
  request(action, selected.value)
}

async function confirmCancel() {
  const targets = cancelling.value
  if (!targets) return
  await run('cancel', targets)
  cancelling.value = null
}

function keepJobs() {
  cancelling.value = null
}
</script>

<template>
  <section class="flex max-w-5xl flex-col gap-4" aria-labelledby="ai-activity-title">
    <h2 id="ai-activity-title" class="sr-only">{{ t('aiArea.sections.activity') }}</h2>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div
        class="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1 shadow-xs"
        role="group"
        :aria-label="t('aiArea.activity.viewsLabel')"
      >
        <button
          v-for="entry in AI_JOB_LIST_VIEWS"
          :key="entry"
          type="button"
          class="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          :class="view === entry ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-muted'"
          :aria-pressed="view === entry"
          :data-testid="`ai-jobs-view-${entry}`"
          @click="selectView(entry)"
        >
          <span>{{ viewLabel(entry) }}</span>
          <template v-if="viewCount(entry) !== null">
            <span
              class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums"
              :class="viewCountClass(entry)"
              aria-hidden="true"
            >
              {{ formatCompactNumber(viewCount(entry) ?? 0) }}
            </span>
            <span class="sr-only">{{ formatNumber(viewCount(entry) ?? 0) }}</span>
          </template>
        </button>
      </div>
      <div
        v-if="manages"
        class="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-xs"
        role="group"
        :aria-label="t('aiArea.activity.scope.label')"
      >
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          :class="scope === 'mine' ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-muted'"
          :aria-pressed="scope === 'mine'"
          data-testid="ai-jobs-scope-mine"
          @click="showMine"
        >
          {{ t('aiArea.activity.scope.mine') }}
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          :class="scope === 'all' ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-muted'"
          :aria-pressed="scope === 'all'"
          data-testid="ai-jobs-scope-all"
          @click="showEveryone"
        >
          {{ t('aiArea.activity.scope.all') }}
        </button>
      </div>
    </div>

    <div
      v-if="selected.length > 0"
      class="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 px-3 py-2 shadow-sm backdrop-blur"
      role="region"
      :aria-label="t('aiArea.activity.bulkLabel')"
      data-testid="ai-jobs-bulk"
    >
      <span class="me-auto text-sm font-medium text-foreground" aria-live="polite">{{
        t('aiArea.activity.selected', { count: selected.length })
      }}</span>
      <Button
        v-for="action in selectedActions"
        :key="action"
        size="sm"
        :variant="action === 'cancel' ? 'destructive' : 'outline'"
        :disabled="busy"
        :data-testid="`ai-jobs-bulk-${action}`"
        @click="handleBulkAction(action)"
      >
        <component :is="AI_JOB_ACTION_ICONS[action]" class="size-3.5" aria-hidden="true" />
        {{ aiJobActionLabel(action) }}
      </Button>
      <Button size="sm" variant="ghost" :disabled="busy" @click="clearSelection">{{ t('aiArea.activity.clearSelection') }}</Button>
    </div>

    <div v-if="loading" class="space-y-3" role="status" :aria-label="t('aiArea.activity.loading')">
      <div v-for="index in 3" :key="index" class="flex gap-4 rounded-xl border border-border bg-card p-4">
        <Skeleton class="h-24 w-16 shrink-0 rounded-md" />
        <div class="flex-1 space-y-2.5 pt-1">
          <Skeleton class="h-4 w-2/5" />
          <Skeleton class="h-3 w-1/4" />
          <Skeleton class="h-2 w-full max-w-md" />
        </div>
      </div>
    </div>

    <div v-else-if="failed && items.length === 0" class="rounded-xl border border-destructive/30 bg-card p-6 text-sm text-foreground" role="alert">
      {{ t('aiArea.activity.loadFailed') }}
      <button
        type="button"
        class="ms-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        @click="retryLoad"
      >
        {{ t('common.retry') }}
      </button>
    </div>

    <div
      v-else-if="items.length === 0"
      class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center"
      data-testid="ai-jobs-empty"
    >
      <span class="grid size-12 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
        <component :is="emptyIcon" class="size-6" />
      </span>
      <p class="text-sm font-medium text-foreground" data-testid="ai-jobs-empty-title">{{ t(`aiArea.activity.empty.${view}`) }}</p>
      <p class="max-w-sm text-sm text-muted-foreground">{{ t(`aiArea.activity.emptyHints.${view}`) }}</p>
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <table class="w-full border-collapse text-start">
        <thead class="border-b border-border bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" class="w-10 min-w-10 py-2 ps-3 text-start font-medium">
              <input
                type="checkbox"
                class="size-4 rounded-xs accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :checked="allSelected"
                :aria-label="t('aiArea.activity.selectAll')"
                data-testid="ai-jobs-select-all"
                @change="toggleAll"
              />
            </th>
            <th scope="col" class="w-8 min-w-8 py-2 text-center font-medium max-sm:hidden">
              <span aria-hidden="true">#</span>
              <span class="sr-only">{{ t('aiArea.activity.columns.position') }}</span>
            </th>
            <th scope="col" class="w-[42%] py-2 pe-3 text-start font-medium max-md:w-full">{{ t('aiArea.activity.columns.book') }}</th>
            <th scope="col" class="py-2 pe-3 text-start font-medium whitespace-nowrap max-sm:hidden">{{ t('aiArea.activity.columns.status') }}</th>
            <th scope="col" class="w-[30%] py-2 pe-3 text-start font-medium max-md:hidden">{{ t('aiArea.activity.columns.details') }}</th>
            <th scope="col" class="py-2 pe-3 text-start font-medium whitespace-nowrap max-xl:hidden">{{ t('aiArea.activity.columns.when') }}</th>
            <th v-if="showingEveryone" scope="col" class="py-2 pe-3 text-start font-medium whitespace-nowrap max-lg:hidden">
              {{ t('aiArea.activity.columns.requester') }}
            </th>
            <th v-if="manages" scope="col" class="py-2 pe-3 text-end font-medium max-md:hidden">{{ t('aiArea.activity.columns.cost') }}</th>
            <th scope="col" class="w-px py-2 pe-2 font-medium">
              <span class="sr-only">{{ t('aiArea.activity.columns.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <AiJobTableRow
            v-for="item in items"
            :key="item.id"
            :item="item"
            :selected="selectedIds.has(item.id)"
            :show-requester="showingEveryone"
            :show-cost="manages"
            :busy="busy"
            @toggle="toggle"
            @act="handleItemAction"
          />
        </tbody>
      </table>
    </div>

    <nav v-if="showPager" class="flex items-center justify-between gap-3 text-sm" :aria-label="t('aiArea.activity.pager.label')">
      <span class="text-muted-foreground tabular-nums">
        {{ t('aiArea.activity.pager.range', { from: formatNumber(offset + 1), to: formatNumber(pageEnd), total: formatNumber(total) }) }}
      </span>
      <div class="flex gap-1">
        <Button
          variant="outline"
          size="icon"
          class="size-8"
          :disabled="!hasPrevious"
          :aria-label="t('aiArea.activity.pager.previous')"
          @click="previousPage"
        >
          <ChevronLeft class="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon" class="size-8" :disabled="!hasNext" :aria-label="t('aiArea.activity.pager.next')" @click="nextPage">
          <ChevronRight class="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </nav>

    <ConfirmDialog
      :open="cancelOpen"
      :title="t('aiArea.activity.confirmCancel.title', { count: cancelCount })"
      :description="t('aiArea.activity.confirmCancel.body')"
      :confirm-label="t('aiArea.activity.confirmCancel.confirm', { count: cancelCount })"
      :busy="busy"
      @confirm="confirmCancel"
      @cancel="keepJobs"
    />
  </section>
</template>
