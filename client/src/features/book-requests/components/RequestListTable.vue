<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronsUpDown, ExternalLink, Zap } from '@lucide/vue'
import type { BookRequestItem, BookRequestProgressEvent, BookRequestSortDirection, BookRequestSortField } from '@bookorbit/types'
import { formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import type { RequestListDensity } from '../composables/useRequestListDensity'
import { requestBookCoverSources } from '../requestBookCover'
import { requestMediaColor, requestMediaIcon } from '../requestMedia'
import { orderedHalves, rowRequests } from '../requestPair'
import { requestFailureText, requestOutcome } from '../requestOutcome'
import { currentRequestProgress, requestPresentationStatus } from '../requestPipeline'
import {
  rowActionModel,
  rowSelectionHalves,
  type RequestViewer,
  type RowActPayload,
  type RowActionModel,
  type RowStep,
  type SelectionHalf,
} from '../requestSelection'
import RequestCover from './RequestCover.vue'
import RequestNextStepButton from './RequestNextStepButton.vue'
import RequestPairCover from './RequestPairCover.vue'
import RequestRowMenu from './RequestRowMenu.vue'
import RequestStatusBadge from './RequestStatusBadge.vue'

const props = defineProps<{
  requests: BookRequestItem[]
  viewer: RequestViewer
  /** Only the approver queue has more than one requester, so only it spends a column on them. */
  showRequester: boolean
  /** Every request with an action in flight, so two rows acted on at once each stay disabled. */
  busyIds: ReadonlySet<number>
  progressByRequest: Record<number, BookRequestProgressEvent | undefined>
  density: RequestListDensity
  sortBy: BookRequestSortField
  sortDir: BookRequestSortDirection
  selectedRowIds: ReadonlySet<number>
  pageSelection: 'none' | 'some' | 'all'
}>()

const emit = defineEmits<{
  open: [id: number]
  act: [payload: RowActPayload, row: BookRequestItem]
  step: [step: RowStep, row: BookRequestItem]
  sort: [field: BookRequestSortField]
  'toggle-select': [row: BookRequestItem]
  'toggle-select-page': []
}>()

const { t } = useI18n()

const isCompact = computed(() => props.density === 'compact')
const cellPadding = computed(() => (isCompact.value ? 'py-1.5' : 'py-2.5'))

interface RowView {
  halves: SelectionHalf[]
  model: RowActionModel
}

/** One pass per refetch rather than one per template call: each row asks its rules several times. */
const rowViews = computed(() => {
  const views = new Map<number, RowView>()
  for (const row of props.requests) {
    const halves = rowSelectionHalves(row, props.viewer.userId)
    views.set(row.id, { halves, model: rowActionModel(halves, props.viewer) })
  }
  return views
})

function viewFor(row: BookRequestItem): RowView {
  return rowViews.value.get(row.id) ?? { halves: [], model: { step: null, groups: [] } }
}

function isPair(row: BookRequestItem): boolean {
  return row.companion != null
}

function mediaLabel(request: BookRequestItem): string {
  return t(`bookRequests.mediaKind.${request.mediaKind}`)
}

function formatLabel(row: BookRequestItem): string {
  return isPair(row) ? t('bookRequests.table.formatPair') : mediaLabel(row)
}

function authorLine(request: BookRequestItem): string {
  return request.authors.join(', ')
}

function skippedApproval(row: BookRequestItem): boolean {
  return rowRequests(row).some((half) => half.selfServe)
}

function liveFor(request: BookRequestItem): BookRequestProgressEvent | null {
  return currentRequestProgress(request, props.progressByRequest[request.id])
}

function statusFor(request: BookRequestItem): BookRequestItem['status'] {
  return requestPresentationStatus(request, liveFor(request))
}

/** Reconcile socket progress with the latest fetched attempt before rendering a transfer bar. */
function progressFor(request: BookRequestItem): { percent: number; done: number; total: number | null } | null {
  const live = liveFor(request)
  const download = request.download
  if (!download) return null
  const status = live?.status ?? download.status
  if (status !== 'queued' && status !== 'downloading') return null
  return {
    percent: Math.max(0, Math.min(100, live?.progressPercent ?? download.progressPercent)),
    done: live?.downloadedBytes ?? download.downloadedBytes,
    total: live?.totalBytes ?? download.totalBytes,
  }
}

/** Locale-formatted: where the percent sign goes, and whether it takes a space, is not universal. */
function percentLabel(request: BookRequestItem): string {
  return formatPercent((progressFor(request)?.percent ?? 0) / 100)
}

function transferLine(request: BookRequestItem): string | null {
  const progress = progressFor(request)
  if (!progress?.total) return null
  return t('bookRequests.download.transferred', { done: formatBytes(progress.done), total: formatBytes(progress.total) })
}

interface NextLine {
  kind: 'progress' | 'failure' | 'text'
  text: string
}

/**
 * What happens next for one request, on one line. Automation being off is a setting, said once in
 * the banner above the list, so the row only says what it needs rather than repeating the why.
 */
function nextLine(request: BookRequestItem): NextLine {
  const outcome = requestOutcome(request, liveFor(request), (iso) => formatRelativeFromNow(new Date(iso)))
  if (outcome.kind === 'progress') return { kind: 'progress', text: percentLabel(request) }
  const failure = requestFailureText(request, (key, named) => t(key, named))
  if (outcome.kind === 'failure') return { kind: 'failure', text: failure ?? t('bookRequests.outcome.failedUnknown') }
  if (request.failureCode === 'AUTOMATION_DISABLED') return { kind: 'text', text: t('bookRequests.nextStep.needsRelease') }
  if (failure) return { kind: 'text', text: failure }
  return { kind: 'text', text: t(`bookRequests.outcome.${outcome.key}`, outcome.params ?? {}) }
}

/** Each half's own art: the ebook's portrait cover and the audiobook's square one. */
function halfCover(row: BookRequestItem, kind: 'ebook' | 'audiobook'): string | null {
  return rowRequests(row).find((request) => request.mediaKind === kind)?.coverUrl ?? null
}

function halfBookCovers(row: BookRequestItem, kind: 'ebook' | 'audiobook'): string[] {
  const half = rowRequests(row).find((request) => request.mediaKind === kind)
  return half ? requestBookCoverSources(half) : []
}

/** The book either half landed as, so a pair that has partly arrived still links somewhere real. */
function landedBookId(row: BookRequestItem): number | null {
  return rowRequests(row).find((request) => request.status === 'available' && request.matchedBookId !== null)?.matchedBookId ?? null
}

function requestedTime(row: BookRequestItem): string {
  return formatRelativeFromNow(new Date(row.createdAt))
}

function isRowBusy(row: BookRequestItem): boolean {
  return rowRequests(row).some((request) => props.busyIds.has(request.id))
}

function isSelected(row: BookRequestItem): boolean {
  return props.selectedRowIds.has(row.id)
}

function ariaSort(field: BookRequestSortField): 'ascending' | 'descending' | 'none' {
  if (props.sortBy !== field) return 'none'
  return props.sortDir === 'asc' ? 'ascending' : 'descending'
}

function sortIcon(field: BookRequestSortField) {
  if (props.sortBy !== field) return ChevronsUpDown
  return props.sortDir === 'asc' ? ArrowUp : ArrowDown
}

function sortByTitle() {
  emit('sort', 'title')
}

function sortByRequested() {
  emit('sort', 'createdAt')
}

function sortByStatus() {
  emit('sort', 'status')
}

function handleTogglePage() {
  emit('toggle-select-page')
}

function handleToggle(row: BookRequestItem) {
  emit('toggle-select', row)
}

function handleOpenRow(row: BookRequestItem) {
  emit('open', row.id)
}

function handleOpenId(id: number) {
  emit('open', id)
}

function handleAct(row: BookRequestItem, payload: RowActPayload) {
  emit('act', payload, row)
}

function handleStep(row: BookRequestItem, step: RowStep) {
  emit('step', step, row)
}

/**
 * The whole row opens the request, which is what its hover promises. Anything interactive inside
 * it keeps its own click, and a drag that selected text is a copy, not a click.
 */
function handleRowClick(row: BookRequestItem, event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, label, [role="menuitem"]')) return
  if (window.getSelection()?.toString()) return
  emit('open', row.id)
}

const SORT_BUTTON =
  'inline-flex items-center gap-1 rounded-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none'
const HEADER = 'px-3 py-2.5 text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase'
</script>

<template>
  <div>
    <!--
      One list, two shapes. The table needs about 1000px before the book column starts to squeeze,
      so below `xl` the same rows stack as cards. Fixed layout: every column but the book has a set
      width, and the book takes whatever is left instead of losing it to the narrow ones.
    -->
    <table class="hidden w-full table-fixed border-collapse text-sm xl:table">
      <caption class="sr-only">
        {{
          t('bookRequests.table.caption')
        }}
      </caption>
      <colgroup>
        <col class="w-11" />
        <col />
        <col :class="showRequester ? 'w-40' : 'w-32'" />
        <col class="w-40" />
        <col class="w-[23%]" />
        <col class="w-44" />
      </colgroup>
      <thead class="sticky top-[calc(3rem-var(--shell-gap))] z-10 bg-card">
        <tr class="border-b border-border">
          <th scope="col" class="px-3 py-2.5">
            <input
              type="checkbox"
              class="block size-4 cursor-pointer rounded-xs border-border accent-primary"
              :checked="pageSelection === 'all'"
              :indeterminate.prop="pageSelection === 'some'"
              :aria-label="t('bookRequests.table.selectPage')"
              @change="handleTogglePage"
            />
          </th>
          <th scope="col" :class="HEADER" :aria-sort="ariaSort('title')">
            <button type="button" :class="SORT_BUTTON" @click="sortByTitle">
              {{ t('bookRequests.table.book') }}
              <component :is="sortIcon('title')" :size="12" aria-hidden="true" />
            </button>
          </th>
          <th scope="col" :class="HEADER" :aria-sort="ariaSort('createdAt')">
            <button type="button" :class="SORT_BUTTON" @click="sortByRequested">
              {{ t('bookRequests.table.requested') }}
              <component :is="sortIcon('createdAt')" :size="12" aria-hidden="true" />
            </button>
          </th>
          <th scope="col" :class="HEADER" :aria-sort="ariaSort('status')">
            <button type="button" :class="SORT_BUTTON" @click="sortByStatus">
              {{ t('bookRequests.table.status') }}
              <component :is="sortIcon('status')" :size="12" aria-hidden="true" />
            </button>
          </th>
          <th scope="col" :class="HEADER">{{ t('bookRequests.table.nextStep') }}</th>
          <th scope="col" class="px-3 py-2.5">
            <span class="sr-only">{{ t('bookRequests.table.actions') }}</span>
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="row in requests"
          :key="row.id"
          class="cursor-pointer border-b border-border/60 transition-colors last:border-b-0 motion-reduce:transition-none"
          :class="isSelected(row) ? 'bg-primary/8 hover:bg-primary/12' : 'hover:bg-muted/50'"
          @click="handleRowClick(row, $event)"
        >
          <td class="px-3 align-middle" :class="cellPadding">
            <input
              type="checkbox"
              class="block size-4 cursor-pointer rounded-xs border-border accent-primary"
              :checked="isSelected(row)"
              :aria-label="t('bookRequests.table.selectRow', { title: row.title })"
              @change="handleToggle(row)"
            />
          </td>

          <td class="px-3" :class="cellPadding">
            <div class="flex min-w-0 items-center gap-3">
              <RequestPairCover
                v-if="isPair(row)"
                :ebook-src="halfCover(row, 'ebook')"
                :audio-src="halfCover(row, 'audiobook')"
                :ebook-fallbacks="halfBookCovers(row, 'ebook')"
                :audio-fallbacks="halfBookCovers(row, 'audiobook')"
                :class="isCompact ? 'me-1 h-8 w-[22px]' : 'me-1.5 h-[46px] w-8'"
                :icon-size="isCompact ? 11 : 14"
              />
              <RequestCover
                v-else
                :src="row.coverUrl"
                :fallback-sources="requestBookCoverSources(row)"
                :media-kind="row.mediaKind"
                :class="isCompact ? 'me-1 h-8 w-[22px]' : 'me-1.5 h-[46px] w-8'"
                :icon-size="isCompact ? 11 : 14"
              />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    class="min-w-0 truncate rounded-xs text-start font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                    :title="row.title"
                    @click="handleOpenRow(row)"
                  >
                    {{ row.title }}
                  </button>
                  <RouterLink
                    v-if="landedBookId(row) !== null"
                    :to="{ name: 'book-detail', params: { bookId: landedBookId(row) } }"
                    class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :title="t('book.actions.bookDetails')"
                  >
                    <ExternalLink :size="13" aria-hidden="true" />
                    <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
                  </RouterLink>
                </div>
                <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                  <span v-if="authorLine(row)" class="min-w-0 truncate">{{ authorLine(row) }}</span>
                  <span v-if="authorLine(row)" aria-hidden="true">·</span>
                  <span class="inline-flex shrink-0 items-center gap-1">
                    <component
                      :is="requestMediaIcon(half.mediaKind)"
                      v-for="half in orderedHalves(row)"
                      :key="half.id"
                      :size="12"
                      :class="requestMediaColor(half.mediaKind)"
                      aria-hidden="true"
                    />
                    {{ formatLabel(row) }}
                  </span>
                  <template v-if="skippedApproval(row)">
                    <span aria-hidden="true">·</span>
                    <span class="inline-flex shrink-0 items-center gap-1" :title="t('bookRequests.table.skippedApprovalHint')">
                      <Zap :size="12" aria-hidden="true" />
                      {{ t('bookRequests.table.skippedApproval') }}
                    </span>
                  </template>
                </p>
              </div>
            </div>
          </td>

          <td class="px-3 text-[13px]" :class="cellPadding">
            <span v-if="showRequester" class="block truncate text-foreground" :title="row.requesterName">{{ row.requesterName }}</span>
            <span class="block truncate text-xs text-muted-foreground tabular-nums">{{ requestedTime(row) }}</span>
          </td>

          <td class="px-3" :class="cellPadding">
            <div class="flex flex-col gap-1">
              <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-1.5">
                <template v-if="isPair(row)">
                  <component :is="requestMediaIcon(half.mediaKind)" :size="13" :class="requestMediaColor(half.mediaKind)" aria-hidden="true" />
                  <span class="sr-only">{{ mediaLabel(half) }}</span>
                </template>
                <RequestStatusBadge :status="statusFor(half)" />
              </div>
            </div>
          </td>

          <td class="px-3 text-[13px]" :class="cellPadding">
            <div class="flex flex-col gap-1">
              <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-2">
                <template v-if="nextLine(half).kind === 'progress'">
                  <div
                    class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    :aria-valuenow="progressFor(half)?.percent ?? 0"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="
                      t('bookRequests.download.progressLabel', { title: isPair(row) ? `${half.title} (${mediaLabel(half)})` : half.title })
                    "
                  >
                    <div
                      class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                      :style="{ width: `${progressFor(half)?.percent ?? 0}%` }"
                    />
                  </div>
                  <span class="min-w-0 truncate text-muted-foreground tabular-nums" :title="transferLine(half) ?? undefined">
                    {{ nextLine(half).text }}
                    <template v-if="transferLine(half)">&middot; {{ transferLine(half) }}</template>
                  </span>
                </template>
                <span
                  v-else
                  class="min-w-0 truncate"
                  :class="nextLine(half).kind === 'failure' ? 'text-destructive' : 'text-muted-foreground'"
                  :title="nextLine(half).text"
                >
                  {{ nextLine(half).text }}
                </span>
              </div>
            </div>
          </td>

          <td class="px-3" :class="cellPadding">
            <div class="flex items-center justify-end gap-1">
              <div class="flex w-28 justify-end">
                <RequestNextStepButton
                  v-if="viewFor(row).model.step"
                  class="w-full"
                  :step="viewFor(row).model.step!"
                  :busy="isRowBusy(row)"
                  @press="handleStep(row, $event)"
                />
              </div>
              <RequestRowMenu
                :title="row.title"
                :halves="viewFor(row).halves"
                :model="viewFor(row).model"
                :busy="isRowBusy(row)"
                @open="handleOpenId"
                @act="handleAct(row, $event)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Below `xl` the same rows stack. Same data, same actions, no second component to keep in step. -->
    <ul class="divide-y divide-border/60 xl:hidden">
      <li
        v-for="row in requests"
        :key="row.id"
        class="cursor-pointer px-3 py-3 transition-colors motion-reduce:transition-none"
        :class="isSelected(row) ? 'bg-primary/8' : 'hover:bg-muted/50'"
        @click="handleRowClick(row, $event)"
      >
        <div class="flex min-w-0 items-start gap-3">
          <label class="-m-2 flex shrink-0 cursor-pointer p-2">
            <input
              type="checkbox"
              class="mt-0.5 block size-4 cursor-pointer rounded-xs border-border accent-primary"
              :checked="isSelected(row)"
              :aria-label="t('bookRequests.table.selectRow', { title: row.title })"
              @change="handleToggle(row)"
            />
          </label>
          <RequestPairCover
            v-if="isPair(row)"
            :ebook-src="halfCover(row, 'ebook')"
            :audio-src="halfCover(row, 'audiobook')"
            :ebook-fallbacks="halfBookCovers(row, 'ebook')"
            :audio-fallbacks="halfBookCovers(row, 'audiobook')"
            class="me-1.5 h-[54px] w-9"
            :icon-size="16"
          />
          <RequestCover
            v-else
            :src="row.coverUrl"
            :fallback-sources="requestBookCoverSources(row)"
            :media-kind="row.mediaKind"
            class="me-1.5 h-[54px] w-9"
            :icon-size="16"
          />

          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    class="min-w-0 truncate rounded-xs text-start text-sm font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                    @click="handleOpenRow(row)"
                  >
                    {{ row.title }}
                  </button>
                  <RouterLink
                    v-if="landedBookId(row) !== null"
                    :to="{ name: 'book-detail', params: { bookId: landedBookId(row) } }"
                    class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :title="t('book.actions.bookDetails')"
                  >
                    <ExternalLink :size="13" aria-hidden="true" />
                    <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
                  </RouterLink>
                </div>
                <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                  <span v-if="authorLine(row)" class="min-w-0 truncate">{{ authorLine(row) }}</span>
                  <span v-if="authorLine(row)" aria-hidden="true">·</span>
                  <span class="inline-flex shrink-0 items-center gap-1">
                    <component
                      :is="requestMediaIcon(half.mediaKind)"
                      v-for="half in orderedHalves(row)"
                      :key="half.id"
                      :size="12"
                      :class="requestMediaColor(half.mediaKind)"
                      aria-hidden="true"
                    />
                    {{ formatLabel(row) }}
                  </span>
                </p>
                <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                  <span class="min-w-0 truncate">
                    {{
                      showRequester
                        ? t('bookRequests.card.requestedByDot', { name: row.requesterName, time: requestedTime(row) })
                        : requestedTime(row)
                    }}
                  </span>
                  <template v-if="skippedApproval(row)">
                    <span aria-hidden="true">·</span>
                    <span class="inline-flex shrink-0 items-center gap-1" :title="t('bookRequests.table.skippedApprovalHint')">
                      <Zap :size="12" aria-hidden="true" />
                      {{ t('bookRequests.table.skippedApproval') }}
                    </span>
                  </template>
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <RequestNextStepButton
                  v-if="viewFor(row).model.step"
                  class="max-w-32 max-sm:hidden"
                  :step="viewFor(row).model.step!"
                  :busy="isRowBusy(row)"
                  @press="handleStep(row, $event)"
                />
                <div class="-me-1.5 -mt-1 flex">
                  <RequestRowMenu
                    :title="row.title"
                    :halves="viewFor(row).halves"
                    :model="viewFor(row).model"
                    :busy="isRowBusy(row)"
                    @open="handleOpenId"
                    @act="handleAct(row, $event)"
                  />
                </div>
              </div>
            </div>

            <div class="mt-2 flex flex-col gap-1">
              <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-2">
                <template v-if="isPair(row)">
                  <component :is="requestMediaIcon(half.mediaKind)" :size="13" :class="requestMediaColor(half.mediaKind)" aria-hidden="true" />
                  <span class="sr-only">{{ mediaLabel(half) }}</span>
                </template>
                <RequestStatusBadge :status="statusFor(half)" />
                <template v-if="nextLine(half).kind === 'progress'">
                  <div
                    class="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    :aria-valuenow="progressFor(half)?.percent ?? 0"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="
                      t('bookRequests.download.progressLabel', { title: isPair(row) ? `${half.title} (${mediaLabel(half)})` : half.title })
                    "
                  >
                    <div
                      class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                      :style="{ width: `${progressFor(half)?.percent ?? 0}%` }"
                    />
                  </div>
                  <span class="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{{ nextLine(half).text }}</span>
                </template>
                <span
                  v-else
                  class="min-w-0 truncate text-xs"
                  :class="nextLine(half).kind === 'failure' ? 'text-destructive' : 'text-muted-foreground'"
                  :title="nextLine(half).text"
                >
                  {{ nextLine(half).text }}
                </span>
              </div>
            </div>

            <RequestNextStepButton
              v-if="viewFor(row).model.step"
              class="mt-2.5 sm:hidden"
              :step="viewFor(row).model.step!"
              :busy="isRowBusy(row)"
              @press="handleStep(row, $event)"
            />
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
