<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { ChevronLeft, ChevronRight, CircleCheck, History } from '@lucide/vue'
import { JOB_VIEWS, Permission, type JobActionKind, type JobActionResponse, type JobListItem, type JobView } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import JobTableRow from '../components/JobTableRow.vue'
import { JOB_PAGE_SIZE, useJobList } from '../composables/useJobList'
import { jobActionLabel, jobDayLabel, jobResultText, jobTypeLabel } from '../lib/job-copy'
import { jobsFilterFromQuery, jobsFilterQuery } from '../lib/jobs-filter'
import { JOB_ACTION_ICONS, JOB_QUEUE_BANDS, jobMoment, jobQueueBand, localDayKey } from '../lib/job-presentation'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const route = useRoute()
const router = useRouter()
const jobs = useJobList(jobsFilterFromQuery(route.query))
const {
  view,
  scope,
  type,
  displayedView,
  displayedScope,
  types,
  scopes,
  page,
  list,
  items,
  counts,
  loading,
  failed,
  acting,
  selectedIds,
  selected,
  selectedActions,
  selectedActionCounts,
  allSelected,
  hasPrevious,
  hasNext,
  toggle,
  toggleAll,
  clearSelection,
} = jobs

/** Those who manage the server see costs. */
const manages = computed(() => hasPermission(Permission.ManageAppSettings))
/** Until the first answer says which scopes the viewer has, the toggle follows the broadest grant. */
const offersEveryone = computed(() => (scopes.value ? scopes.value.includes('everyone') : manages.value))
/** The type filter only helps someone who sees more than one type. */
const offersTypes = computed(() => types.value.length > 1)
const typeChoice = computed<string>({
  get: () => type.value ?? '',
  set: (value) => {
    type.value = types.value.find((entry) => entry === value) ?? null
  },
})

const filterQuery = computed(() => jobsFilterQuery({ view: view.value, type: type.value, scope: scope.value }))

function syncAddress() {
  if (route.name !== 'jobs-activity') return
  if (JSON.stringify(filterQuery.value) === JSON.stringify(jobsFilterQuery(jobsFilterFromQuery(route.query)))) return
  void router.replace({ query: filterQuery.value })
}

/** A link into the page, such as a toast's "Open Jobs", while the page is already open. */
function followAddress() {
  if (route.name !== 'jobs-activity') return
  const next = jobsFilterFromQuery(route.query)
  view.value = next.view
  type.value = next.type
  scope.value = next.scope
}

watch(filterQuery, syncAddress)
watch(() => route.query, followAddress)
const showingEveryone = computed(() => displayedScope.value === 'everyone')
const busy = computed(() => acting.value !== null)
const labelFirst = computed(() => displayedView.value === 'needs-you' || displayedView.value === 'failed')
const columnCount = computed(() => 7 + (showingEveryone.value ? 1 : 0))
const emptyIcon = computed(() => (displayedView.value === 'history' ? History : CircleCheck))

interface Band {
  key: string
  name: string
  hint: string | null
  rows: JobListItem[]
}

/** Queue rows grouped into its bands, History rows by the day they ended; other views are one list. */
const bands = computed<Band[]>(() => {
  if (displayedView.value === 'queue') {
    return JOB_QUEUE_BANDS.map((band) => ({
      key: band,
      name: t(`jobsArea.bands.${band}.name`),
      hint: t(`jobsArea.bands.${band}.hint`),
      rows: items.value.filter((item) => jobQueueBand(item) === band),
    })).filter((band) => band.rows.length > 0)
  }
  if (displayedView.value === 'history') {
    const days = new Map<string, JobListItem[]>()
    for (const item of items.value) {
      const day = localDayKey(jobMoment(item).at)
      days.set(day, [...(days.get(day) ?? []), item])
    }
    return [...days].map(([day, rows]) => ({ key: day, name: jobDayLabel(day), hint: null, rows }))
  }
  return [{ key: displayedView.value, name: '', hint: null, rows: items.value }]
})
const banded = computed(() => displayedView.value === 'queue' || displayedView.value === 'history')

const viewTotal = computed(() => {
  if (!counts.value) return null
  if (displayedView.value === 'queue') return counts.value.queue
  if (displayedView.value === 'needs-you') return counts.value.needsYou
  if (displayedView.value === 'failed') return counts.value.failed
  return null
})
const showPager = computed(() => hasPrevious.value || hasNext.value)
const rangeText = computed(() => {
  if (viewTotal.value === null) return t('jobsArea.pager.page', { page: formatNumber(page.value + 1) })
  const from = page.value * JOB_PAGE_SIZE + 1
  return t('aiArea.activity.pager.range', {
    from: formatNumber(from),
    to: formatNumber(from + items.value.length - 1),
    total: formatNumber(viewTotal.value),
  })
})

/** Jobs waiting on the Cancel confirmation. */
const cancelling = ref<JobListItem[] | null>(null)
const cancelOpen = computed(() => cancelling.value !== null)
const cancelCount = computed(() => cancelling.value?.filter((item) => item.actions.includes('cancel')).length ?? 0)

function viewLabel(entry: JobView): string {
  if (entry === 'needs-you') return scope.value === 'everyone' ? t('jobsArea.views.needsReview') : t('jobsArea.views.needsYou')
  return t(`aiArea.activity.views.${entry}`)
}

function viewCount(entry: JobView): number | null {
  if (!counts.value || entry === 'history') return null
  if (entry === 'queue') return counts.value.queue
  if (entry === 'needs-you') return counts.value.needsYou
  return counts.value.failed
}

/** Failed jobs and those waiting on someone stand out even while another view is open. */
function viewCountClass(entry: JobView): string {
  if (view.value === entry) return 'bg-primary/15 text-primary'
  const count = viewCount(entry) ?? 0
  if (entry === 'failed' && count > 0) return 'bg-destructive/12 text-destructive'
  if (entry === 'needs-you' && count > 0) return 'bg-info/10 text-info'
  return 'bg-muted text-muted-foreground'
}

function selectView(entry: JobView) {
  view.value = entry
}

/** How many of the selected jobs an action applies to, when that is fewer than all of them. */
function partialCount(action: JobActionKind): number | null {
  const count = selectedActionCounts.value.get(action) ?? 0
  return count < selected.value.length ? count : null
}

function showMine() {
  scope.value = 'mine'
}

function showEveryone() {
  scope.value = 'everyone'
}

function retryLoad() {
  void jobs.load(true)
}

function report(action: JobActionKind, response: JobActionResponse) {
  const done = response.results.filter((result) => result.outcome === 'done').length
  const stillPaused = response.results.filter((result) => result.outcome === 'still-paused').length
  const other = response.results.length - done - stillPaused
  if (done > 0) toast.success(jobResultText(action, done))
  if (stillPaused > 0) toast.info(t('aiArea.activity.results.stillPaused', { count: stillPaused }))
  if (other > 0) toast.warning(t('aiArea.activity.results.unchanged', { count: other }))
}

async function run(action: JobActionKind, targets: readonly JobListItem[]) {
  try {
    const response = await jobs.act(action, targets)
    if (response) report(action, response)
  } catch (reason) {
    toast.error(errorMessage(reason, 'jobsArea.actionFailed'))
  }
}

function request(action: JobActionKind, targets: readonly JobListItem[]) {
  if (action === 'cancel') {
    cancelling.value = [...targets]
    return
  }
  void run(action, targets)
}

function handleItemAction(action: JobActionKind, item: JobListItem) {
  request(action, [item])
}

function handleBulkAction(action: JobActionKind) {
  request(action, selected.value)
}

function handleNote(text: string) {
  toast.info(text)
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

function handlePrevious() {
  jobs.previousPage()
}

function handleNext() {
  jobs.nextPage()
}
</script>

<template>
  <section class="flex flex-col gap-5" aria-labelledby="jobs-activity-title">
    <h2 id="jobs-activity-title" class="sr-only">{{ t('aiArea.sections.activity') }}</h2>

    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
      <div
        class="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1 shadow-xs max-sm:grid max-sm:w-full max-sm:grid-cols-2"
        role="group"
        :aria-label="t('aiArea.activity.viewsLabel')"
      >
        <button
          v-for="entry in JOB_VIEWS"
          :key="entry"
          type="button"
          class="inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          :class="view === entry ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-muted'"
          :aria-pressed="view === entry"
          :data-testid="`jobs-view-${entry}`"
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
      <div v-if="offersTypes || offersEveryone" class="flex flex-wrap items-center gap-2 max-sm:w-full">
        <Select
          v-if="offersTypes"
          v-model="typeChoice"
          class="h-[42px] w-auto bg-card pe-8 md:text-sm max-sm:w-full"
          :aria-label="t('jobsArea.filter.typeLabel')"
          data-testid="jobs-type"
        >
          <option value="">{{ t('jobsArea.filter.allTypes') }}</option>
          <option v-for="entry in types" :key="entry" :value="entry">{{ jobTypeLabel(entry) }}</option>
        </Select>
        <div
          v-if="offersEveryone"
          class="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-xs max-sm:grid max-sm:w-full max-sm:grid-cols-2"
          role="group"
          :aria-label="t('aiArea.activity.scope.label')"
        >
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            :class="scope === 'mine' ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-muted'"
            :aria-pressed="scope === 'mine'"
            data-testid="jobs-scope-mine"
            @click="showMine"
          >
            {{ t('aiArea.activity.scope.mine') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            :class="scope === 'everyone' ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-muted'"
            :aria-pressed="scope === 'everyone'"
            data-testid="jobs-scope-everyone"
            @click="showEveryone"
          >
            {{ t('aiArea.activity.scope.all') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="selected.length > 0"
      class="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 px-3 py-2 shadow-sm backdrop-blur"
      role="region"
      :aria-label="t('aiArea.activity.bulkLabel')"
      data-testid="jobs-bulk"
    >
      <span class="me-auto text-sm font-medium text-foreground" aria-live="polite">
        {{ t('aiArea.activity.selected', { count: selected.length }) }}
        <span v-if="selectedActions.length === 0" class="font-normal text-muted-foreground">{{ t('jobsArea.noBulkActions') }}</span>
      </span>
      <Button
        v-for="action in selectedActions"
        :key="action"
        size="sm"
        :variant="action === 'cancel' ? 'destructive' : 'outline'"
        :disabled="busy"
        :data-testid="`jobs-bulk-${action}`"
        @click="handleBulkAction(action)"
      >
        <component :is="JOB_ACTION_ICONS[action]" class="size-3.5" aria-hidden="true" />
        {{ jobActionLabel(action) }}
        <template v-if="partialCount(action) !== null">
          <span class="rounded-full border border-current/30 px-1.5 text-[11px] leading-4 font-semibold tabular-nums" aria-hidden="true">
            {{ formatNumber(partialCount(action) ?? 0) }}
          </span>
          <span class="sr-only">{{ t('jobsArea.bulkAppliesTo', { count: partialCount(action) ?? 0, total: selected.length }) }}</span>
        </template>
      </Button>
      <Button size="sm" variant="ghost" :disabled="busy" @click="clearSelection">{{ t('aiArea.activity.clearSelection') }}</Button>
    </div>

    <div
      v-if="loading && list === null"
      class="overflow-hidden rounded-xl border border-border bg-card"
      role="status"
      :aria-label="t('jobsArea.loading')"
      data-testid="jobs-loading-skeleton"
    >
      <div v-for="index in 4" :key="index" class="flex h-[41px] items-center gap-3 border-t border-border px-4 first:border-t-0">
        <Skeleton class="size-4 rounded-xs" />
        <Skeleton class="h-7 w-5 rounded-[3px]" />
        <Skeleton class="h-3.5 w-2/5" />
        <Skeleton class="ms-auto h-3 w-24" />
      </div>
    </div>

    <div v-else-if="failed && items.length === 0" class="rounded-xl border border-destructive/30 bg-card p-6 text-sm text-foreground" role="alert">
      {{ t('jobsArea.loadFailed') }}
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
      data-testid="jobs-empty"
    >
      <span class="grid size-12 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
        <component :is="emptyIcon" class="size-6" />
      </span>
      <p class="text-sm font-medium text-foreground" data-testid="jobs-empty-title">{{ t(`jobsArea.empty.${displayedView}.title`) }}</p>
      <p class="max-w-sm text-sm text-muted-foreground">{{ t(`jobsArea.empty.${displayedView}.hint`) }}</p>
    </div>

    <div
      v-else
      class="@container/jobs overflow-hidden rounded-xl border border-border bg-card shadow-xs"
      :aria-busy="loading"
      data-testid="jobs-table"
    >
      <span v-if="loading" class="sr-only" role="status">{{ t('jobsArea.loading') }}</span>
      <table class="w-full border-collapse text-start [&_tbody>tr:first-child>td]:border-t-0 [&_tr[data-band]+tr>td]:border-t-0">
        <thead>
          <tr>
            <th scope="col" class="h-9 w-px border-b border-border bg-muted/40 ps-4 pe-3 text-start @max-4xl/jobs:ps-3 @max-4xl/jobs:pe-2">
              <input
                type="checkbox"
                class="block size-4 rounded-xs accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :checked="allSelected"
                :aria-label="t('aiArea.activity.selectAll')"
                data-testid="jobs-select-all"
                @change="toggleAll"
              />
            </th>
            <th scope="col" class="h-9 w-full border-b border-border bg-muted/40 pe-3.5 text-start text-xs font-medium text-muted-foreground">
              {{ t('jobsArea.columns.job') }}
            </th>
            <th
              scope="col"
              class="h-9 border-b border-border bg-muted/40 pe-3.5 text-start text-xs font-medium whitespace-nowrap text-muted-foreground @max-6xl/jobs:hidden"
            >
              {{ t('jobsArea.columns.type') }}
            </th>
            <th
              scope="col"
              class="h-9 border-b border-border bg-muted/40 pe-3.5 text-start text-xs font-medium whitespace-nowrap text-muted-foreground @max-4xl/jobs:hidden"
            >
              {{ t('aiArea.activity.columns.status') }}
            </th>
            <th
              scope="col"
              class="h-9 border-b border-border bg-muted/40 pe-3.5 text-start text-xs font-medium whitespace-nowrap text-muted-foreground @max-4xl/jobs:hidden"
            >
              {{ t('aiArea.activity.columns.details') }}
            </th>
            <th
              v-if="showingEveryone"
              scope="col"
              class="h-9 border-b border-border bg-muted/40 pe-3.5 text-start text-xs font-medium whitespace-nowrap text-muted-foreground @max-6xl/jobs:hidden"
            >
              {{ t('jobsArea.columns.requester') }}
            </th>
            <th
              scope="col"
              class="h-9 border-b border-border bg-muted/40 pe-3.5 text-start text-xs font-medium whitespace-nowrap text-muted-foreground @max-5xl/jobs:hidden"
            >
              {{ t('aiArea.activity.columns.when') }}
            </th>
            <th scope="col" class="h-9 w-px border-b border-border bg-muted/40 pe-3">
              <span class="sr-only">{{ t('aiArea.activity.columns.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="band in bands" :key="band.key">
            <tr v-if="banded" data-band :data-testid="`jobs-band-${band.key}`">
              <td :colspan="columnCount" class="h-8 border-t border-border bg-muted/40 px-4 @max-4xl/jobs:px-3.5">
                <div class="flex min-w-0 items-baseline gap-2">
                  <span class="text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-foreground uppercase">{{ band.name }}</span>
                  <span class="text-[11px] font-semibold text-muted-foreground tabular-nums">{{ formatNumber(band.rows.length) }}</span>
                  <span v-if="band.hint" class="min-w-0 truncate text-xs text-muted-foreground @max-4xl/jobs:hidden">{{ band.hint }}</span>
                </div>
              </td>
            </tr>
            <JobTableRow
              v-for="item in band.rows"
              :key="item.id"
              :item="item"
              :selected="selectedIds.has(item.id)"
              :show-requester="showingEveryone"
              :show-cost="manages"
              :label-first="labelFirst"
              :busy="busy"
              @toggle="toggle"
              @act="handleItemAction"
              @note="handleNote"
            />
          </template>
        </tbody>
      </table>
    </div>

    <nav v-if="showPager && items.length > 0" class="flex items-center justify-between gap-3 text-sm" :aria-label="t('aiArea.activity.pager.label')">
      <span class="text-muted-foreground tabular-nums" data-testid="jobs-range">{{ rangeText }}</span>
      <div class="flex gap-1">
        <Button
          variant="outline"
          size="icon"
          class="size-8"
          :disabled="!hasPrevious"
          :aria-label="t('aiArea.activity.pager.previous')"
          data-testid="jobs-previous"
          @click="handlePrevious"
        >
          <ChevronLeft class="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          class="size-8"
          :disabled="!hasNext"
          :aria-label="t('aiArea.activity.pager.next')"
          data-testid="jobs-next"
          @click="handleNext"
        >
          <ChevronRight class="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </nav>

    <ConfirmDialog
      :open="cancelOpen"
      :title="t('aiArea.activity.confirmCancel.title', { count: cancelCount })"
      :description="t('jobsArea.confirmCancel.body')"
      :confirm-label="t('aiArea.activity.confirmCancel.confirm', { count: cancelCount })"
      :busy="busy"
      @confirm="confirmCancel"
      @cancel="keepJobs"
    />
  </section>
</template>
