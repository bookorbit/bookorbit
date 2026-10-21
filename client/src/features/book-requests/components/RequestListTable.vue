<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronsUpDown, ExternalLink, EyeOff, TriangleAlert, Zap } from '@lucide/vue'
import { isGrabbableBookRequestStatus } from '@bookorbit/types'
import type { BookRequestItem, BookRequestProgressEvent, BookRequestSortDirection, BookRequestSortField } from '@bookorbit/types'
import { formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import type { RequestListDensity } from '../composables/useRequestListDensity'
import { canBulkActRequest } from '../requestActions'
import { requestBookCoverSources } from '../requestBookCover'
import { requestMediaColor, requestMediaIcon } from '../requestMedia'
import { orderedHalves, rowRequests } from '../requestPair'
import { requestFailureText, requestOutcome } from '../requestOutcome'
import { currentRequestProgress, requestPresentationStatus } from '../requestPipeline'
import RequestCover from './RequestCover.vue'
import RequestPairCover from './RequestPairCover.vue'
import RequestPairRowActions from './RequestPairRowActions.vue'
import RequestPipeline from './RequestPipeline.vue'
import RequestRowActions from './RequestRowActions.vue'
import RequestStatusBadge from './RequestStatusBadge.vue'

const props = defineProps<{
  requests: BookRequestItem[]
  canManage: boolean
  /** Whether the viewer may drive fulfilment on rows that are theirs to drive. */
  canSelfFulfil: boolean
  currentUserId: number | null
  /** Every row with an action in flight, so two rows acted on at once each stay disabled. */
  busyIds: ReadonlySet<number>
  progressByRequest: Record<number, BookRequestProgressEvent | undefined>
  density: RequestListDensity
  sortBy: BookRequestSortField
  sortDir: BookRequestSortDirection
  selectedIds: number[]
}>()

const emit = defineEmits<{
  open: [request: BookRequestItem]
  approve: [request: BookRequestItem]
  reject: [request: BookRequestItem]
  cancel: [request: BookRequestItem]
  dismiss: [request: BookRequestItem]
  restore: [request: BookRequestItem]
  remove: [request: BookRequestItem]
  grab: [request: BookRequestItem]
  /** One press on a pair row, carrying exactly the halves it applies to. */
  'pair-approve': [requests: BookRequestItem[]]
  'pair-reject': [requests: BookRequestItem[]]
  'pair-cancel': [requests: BookRequestItem[]]
  'pair-dismiss': [requests: BookRequestItem[]]
  'pair-restore': [requests: BookRequestItem[]]
  sort: [field: BookRequestSortField]
  'toggle-select': [request: BookRequestItem]
  'toggle-select-all': []
}>()

const { t } = useI18n()

const isCompact = computed(() => props.density === 'compact')

function mediaIcon(request: BookRequestItem) {
  return requestMediaIcon(request.mediaKind)
}

function mediaColor(request: BookRequestItem): string {
  return requestMediaColor(request.mediaKind)
}

/** The icon stands alone in the row, so the medium has to reach assistive tech some other way. */
function mediaLabel(request: BookRequestItem): string {
  return t(`bookRequests.mediaKind.${request.mediaKind}`)
}

function authorLine(request: BookRequestItem): string {
  return request.authors.join(', ')
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

function liveFor(request: BookRequestItem): BookRequestProgressEvent | null {
  return currentRequestProgress(request, props.progressByRequest[request.id])
}

function statusFor(request: BookRequestItem): BookRequestItem['status'] {
  return requestPresentationStatus(request, liveFor(request))
}

function outcomeFor(request: BookRequestItem) {
  return requestOutcome(request, liveFor(request), (iso) => formatRelativeFromNow(new Date(iso)))
}

/** Per row rather than computed: the list renders hundreds and each one asks about its own request. */
function failureFor(request: BookRequestItem): string | null {
  return requestFailureText(request, (key, named) => t(key, named))
}

/** Whether the reason describes something that went wrong, as opposed to something to do next. */
function isFailure(request: BookRequestItem): boolean {
  return outcomeFor(request).kind === 'failure'
}

function transferLine(request: BookRequestItem): string | null {
  const progress = progressFor(request)
  if (!progress?.total) return null
  return t('bookRequests.download.transferred', { done: formatBytes(progress.done), total: formatBytes(progress.total) })
}

function isPending(request: BookRequestItem): boolean {
  return request.status === 'pending'
}

function canGrab(request: BookRequestItem): boolean {
  return props.canManage && isGrabbableBookRequestStatus(request.status)
}

/**
 * A row with no destination library is still selectable: the endpoint names it in the failure list,
 * which is more use than a checkbox that silently refuses to tick. A pair row is one checkbox for
 * whichever of its halves a bulk action can reach.
 */
function selectableHalves(row: BookRequestItem): BookRequestItem[] {
  return rowRequests(row).filter((request) => canBulkActRequest(request, props.canManage))
}

function isSelectable(row: BookRequestItem): boolean {
  return selectableHalves(row).length > 0
}

function isSelected(row: BookRequestItem): boolean {
  const halves = selectableHalves(row)
  return halves.length > 0 && halves.every((request) => props.selectedIds.includes(request.id))
}

const selectableIds = computed(() => props.requests.flatMap(selectableHalves).map((request) => request.id))
const hasSelectableRows = computed(() => selectableIds.value.length > 0)
const allSelected = computed(() => hasSelectableRows.value && selectableIds.value.every((id) => props.selectedIds.includes(id)))
const someSelected = computed(() => selectableIds.value.some((id) => props.selectedIds.includes(id)))

/** A settled row's actions stay reachable but stop competing with the rows that need a decision. */
function actionsAreQuiet(request: BookRequestItem): boolean {
  return rowRequests(request).every((half) => !isPending(half) && !canGrab(half))
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

function sortByMediaKind() {
  emit('sort', 'mediaKind')
}

function sortByRequester() {
  emit('sort', 'requester')
}

function sortByAge() {
  emit('sort', 'createdAt')
}

function sortByState() {
  emit('sort', 'status')
}

function toggleSelectAll() {
  emit('toggle-select-all')
}

function handleToggleSelect(request: BookRequestItem) {
  emit('toggle-select', request)
}

function handleOpen(request: BookRequestItem) {
  emit('open', request)
}

function handleApprove(request: BookRequestItem) {
  emit('approve', request)
}

function handleReject(request: BookRequestItem) {
  emit('reject', request)
}

function handleCancel(request: BookRequestItem) {
  emit('cancel', request)
}

function handleDismiss(request: BookRequestItem) {
  emit('dismiss', request)
}

function handleRestore(request: BookRequestItem) {
  emit('restore', request)
}

function handleRemove(request: BookRequestItem) {
  emit('remove', request)
}

function handleGrab(request: BookRequestItem) {
  emit('grab', request)
}

function handlePairApprove(requests: BookRequestItem[]) {
  emit('pair-approve', requests)
}

function handlePairReject(requests: BookRequestItem[]) {
  emit('pair-reject', requests)
}

function handlePairCancel(requests: BookRequestItem[]) {
  emit('pair-cancel', requests)
}

function handlePairDismiss(requests: BookRequestItem[]) {
  emit('pair-dismiss', requests)
}

function handlePairRestore(requests: BookRequestItem[]) {
  emit('pair-restore', requests)
}

function isPair(row: BookRequestItem): boolean {
  return row.companion != null
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

/** A pair row is busy while either half has an action in flight. */
function isRowBusy(row: BookRequestItem): boolean {
  return rowRequests(row).some((request) => props.busyIds.has(request.id))
}

function rowDismissed(row: BookRequestItem): boolean {
  return rowRequests(row).every((request) => request.dismissed)
}
</script>

<template>
  <div class="rounded-lg border border-border bg-card">
    <!--
      One list, two shapes. The table needs roughly 900px of columns before anything truncates, so
      below `lg` the same rows stack rather than growing a horizontal scrollbar. Nothing wraps the
      table in an overflow container on purpose: `overflow-x` would trap the sticky header inside a
      box that never scrolls vertically, and the header would stop sticking.
    -->
    <table class="hidden w-full border-collapse text-sm lg:table">
      <caption class="sr-only">
        {{
          t('bookRequests.table.caption')
        }}
      </caption>
      <thead class="sticky top-0 z-10 bg-card">
        <tr class="border-b border-border">
          <th v-if="hasSelectableRows" scope="col" class="w-10 px-3 py-2.5">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 rounded-xs border-border accent-primary"
              :checked="allSelected"
              :indeterminate.prop="someSelected && !allSelected"
              :aria-label="t('bookRequests.table.selectAll')"
              @change="toggleSelectAll"
            />
          </th>

          <th scope="col" class="px-3 py-2.5 text-start" :aria-sort="ariaSort('title')">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              @click="sortByTitle"
            >
              {{ t('bookRequests.table.title') }}
              <component :is="sortIcon('title')" :size="12" aria-hidden="true" />
            </button>
          </th>

          <th scope="col" class="w-24 px-3 py-2.5 text-start" :aria-sort="ariaSort('mediaKind')">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              @click="sortByMediaKind"
            >
              {{ t('bookRequests.table.mediaKind') }}
              <component :is="sortIcon('mediaKind')" :size="12" aria-hidden="true" />
            </button>
          </th>

          <th scope="col" class="hidden w-36 px-3 py-2.5 text-start xl:table-cell" :aria-sort="ariaSort('requester')">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              @click="sortByRequester"
            >
              {{ t('bookRequests.table.requestedBy') }}
              <component :is="sortIcon('requester')" :size="12" aria-hidden="true" />
            </button>
          </th>

          <th scope="col" class="w-32 px-3 py-2.5 text-start" :aria-sort="ariaSort('createdAt')">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              @click="sortByAge"
            >
              {{ t('bookRequests.table.age') }}
              <component :is="sortIcon('createdAt')" :size="12" aria-hidden="true" />
            </button>
          </th>

          <th scope="col" class="w-40 px-3 py-2.5 text-start" :aria-sort="ariaSort('status')">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              @click="sortByState"
            >
              {{ t('bookRequests.table.state') }}
              <component :is="sortIcon('status')" :size="12" aria-hidden="true" />
            </button>
          </th>

          <th scope="col" class="w-72 px-3 py-2.5 text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {{ t('bookRequests.table.outcome') }}
          </th>

          <th scope="col" class="w-44 px-3 py-2.5">
            <span class="sr-only">{{ t('bookRequests.table.actions') }}</span>
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="request in requests"
          :key="request.id"
          class="border-b border-border/60 hover:bg-muted/40"
          :class="[isSelected(request) && 'bg-primary/8', rowDismissed(request) && 'opacity-60']"
        >
          <td v-if="hasSelectableRows" class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            <input
              v-if="isSelectable(request)"
              type="checkbox"
              class="h-3.5 w-3.5 rounded-xs border-border accent-primary"
              :checked="isSelected(request)"
              :aria-label="t('bookRequests.table.selectRow', { title: request.title })"
              @change="handleToggleSelect(request)"
            />
          </td>

          <!-- Auto table layout uses the nowrap title's intrinsic width unless the cell itself is bounded. -->
          <td class="max-w-0 px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            <div class="flex min-w-0 items-center gap-2.5">
              <RequestPairCover
                v-if="isPair(request)"
                :ebook-src="halfCover(request, 'ebook')"
                :audio-src="halfCover(request, 'audiobook')"
                :ebook-fallbacks="halfBookCovers(request, 'ebook')"
                :audio-fallbacks="halfBookCovers(request, 'audiobook')"
                :class="isCompact ? 'me-1 h-8 w-[22px]' : 'me-1.5 h-[46px] w-8'"
                :icon-size="isCompact ? 11 : 14"
              />
              <RequestCover
                v-else
                :src="request.coverUrl"
                :fallback-sources="requestBookCoverSources(request)"
                :media-kind="request.mediaKind"
                :class="isCompact ? 'h-8 w-[22px]' : 'h-[46px] w-8'"
                :icon-size="isCompact ? 11 : 14"
              />
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    class="min-w-0 truncate text-start font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                    @click="handleOpen(request)"
                  >
                    {{ request.title }}
                  </button>
                  <RouterLink
                    v-if="landedBookId(request) !== null"
                    :to="{ name: 'book-detail', params: { bookId: landedBookId(request) } }"
                    class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :title="t('book.actions.bookDetails')"
                  >
                    <ExternalLink :size="14" aria-hidden="true" />
                    <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
                  </RouterLink>
                </div>
                <span v-if="authorLine(request)" class="block truncate text-xs text-muted-foreground">{{ authorLine(request) }}</span>
              </div>
            </div>
          </td>

          <td class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            <span v-if="isPair(request)" class="inline-flex items-center gap-1" :title="t('bookRequests.table.pairMedia')">
              <component
                :is="mediaIcon(half)"
                v-for="half in orderedHalves(request)"
                :key="half.id"
                :size="16"
                :class="mediaColor(half)"
                aria-hidden="true"
              />
              <span class="sr-only">{{ t('bookRequests.table.pairMedia') }}</span>
            </span>
            <span v-else class="inline-flex" :title="mediaLabel(request)">
              <component :is="mediaIcon(request)" :size="16" :class="mediaColor(request)" aria-hidden="true" />
              <span class="sr-only">{{ mediaLabel(request) }}</span>
            </span>
          </td>

          <!--
            `max-w-0` with the header's `w-36`: an auto-layout table sizes a column to its widest
            content, so `truncate` alone never fires here and one long display name takes its width
            out of Title instead. Zero maximum plus a stated width is what holds the column still.
          -->
          <td class="hidden max-w-0 truncate px-3 text-muted-foreground xl:table-cell" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            <span :title="request.requesterName">{{ request.requesterName }}</span>
          </td>

          <td class="px-3 text-xs text-muted-foreground whitespace-nowrap tabular-nums" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            {{ formatRelativeFromNow(new Date(request.createdAt)) }}
          </td>

          <!-- Pipeline and State were two columns saying one thing; the stage bar rides the chip. -->
          <td class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            <!--
              A pair is two lanes, one per half, each on a fixed-height line so the Outcome column's
              lanes line up beside them. The stage bar is left to the drawer: two of them made every
              pair row three times the height of the rows around it.
            -->
            <div v-if="isPair(request)" class="flex flex-col gap-1">
              <div v-for="half in orderedHalves(request)" :key="half.id" class="flex h-6 items-center gap-1.5">
                <component :is="mediaIcon(half)" :size="13" :class="mediaColor(half)" aria-hidden="true" />
                <span class="sr-only">{{ mediaLabel(half) }}</span>
                <RequestStatusBadge :status="statusFor(half)" />
                <span v-if="half.selfServe" class="inline-flex text-muted-foreground" :title="t('bookRequests.selfServeBadgeHint')">
                  <Zap :size="12" aria-hidden="true" />
                  <span class="sr-only">{{ t('bookRequests.selfServeBadge') }}</span>
                </span>
              </div>
            </div>
            <div v-else class="inline-flex flex-col items-start gap-2">
              <!--
                The self-serve marker rides beside the chip rather than under it. Stacked, it added a
                line to this cell and left the table ragged: rows carrying it stood 19px taller than
                rows that did not. The column has room for a chip plus an icon and not for a chip
                plus a second pill, so the label moves into the tooltip and the screen-reader text.
              -->
              <div class="inline-flex items-center gap-1.5">
                <RequestStatusBadge :status="statusFor(request)" />
                <span v-if="request.selfServe" class="inline-flex text-muted-foreground" :title="t('bookRequests.selfServeBadgeHint')">
                  <Zap :size="12" aria-hidden="true" />
                  <span class="sr-only">{{ t('bookRequests.selfServeBadge') }}</span>
                </span>
              </div>
              <RequestPipeline v-if="!isCompact" :request="request" :live="liveFor(request)" compact />
              <span v-if="request.dismissed" class="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <EyeOff :size="11" aria-hidden="true" />
                {{ t('bookRequests.card.dismissedBadge') }}
              </span>
            </div>
          </td>

          <td class="px-3 text-xs" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            <div v-if="isPair(request)" class="flex flex-col gap-1">
              <div v-for="half in orderedHalves(request)" :key="half.id" class="flex h-6 min-w-0 items-center gap-2">
                <template v-if="outcomeFor(half).kind === 'progress'">
                  <div
                    class="h-1.5 w-full max-w-20 shrink-0 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    :aria-valuenow="progressFor(half)?.percent ?? 0"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="t('bookRequests.download.progressLabel', { title: `${half.title} (${mediaLabel(half)})` })"
                  >
                    <div
                      class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                      :style="{ width: `${progressFor(half)?.percent ?? 0}%` }"
                    />
                  </div>
                  <span class="text-muted-foreground tabular-nums">{{ percentLabel(half) }}</span>
                </template>
                <span v-else-if="isFailure(half)" class="truncate text-destructive" :title="failureFor(half) ?? undefined">
                  {{ failureFor(half) ?? t('bookRequests.outcome.failedUnknown') }}
                </span>
                <span v-else-if="failureFor(half)" class="truncate text-muted-foreground" :title="failureFor(half) ?? undefined">
                  {{ failureFor(half) }}
                </span>
                <span v-else class="truncate text-muted-foreground">
                  {{ t(`bookRequests.outcome.${outcomeFor(half).key}`, outcomeFor(half).params ?? {}) }}
                </span>
              </div>
            </div>
            <template v-else-if="outcomeFor(request).kind === 'progress'">
              <div
                class="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                :aria-valuenow="progressFor(request)?.percent ?? 0"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="t('bookRequests.download.progressLabel', { title: request.title })"
              >
                <div
                  class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                  :style="{ width: `${progressFor(request)?.percent ?? 0}%` }"
                />
              </div>
              <p class="mt-1 text-muted-foreground tabular-nums">
                {{ percentLabel(request) }}
                <template v-if="transferLine(request)">&middot; {{ transferLine(request) }}</template>
              </p>
            </template>

            <p v-else-if="isFailure(request)" class="line-clamp-2 text-destructive">
              {{ failureFor(request) ?? t('bookRequests.outcome.failedUnknown') }}
            </p>

            <!--
              A request automation handed back is still `approved`, and the stage line for that state
              reads "Looking for a release" - which is the one thing nothing is doing for it. When
              there is a reason on the row, the reason is the outcome.
            -->
            <p v-else-if="failureFor(request)" class="line-clamp-2 text-muted-foreground">
              {{ failureFor(request) }}
            </p>

            <p v-else class="text-muted-foreground">
              {{ t(`bookRequests.outcome.${outcomeFor(request).key}`, outcomeFor(request).params ?? {}) }}
            </p>
          </td>

          <td class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
            <div
              class="flex items-center justify-end gap-1"
              :class="
                actionsAreQuiet(request) && 'opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none'
              "
            >
              <RequestPairRowActions
                v-if="isPair(request)"
                :row="request"
                :can-manage="canManage"
                :can-self-fulfil="canSelfFulfil"
                :current-user-id="currentUserId"
                :busy="isRowBusy(request)"
                @open="handleOpen"
                @grab="handleGrab"
                @approve="handlePairApprove"
                @reject="handlePairReject"
                @cancel="handlePairCancel"
                @dismiss="handlePairDismiss"
                @restore="handlePairRestore"
              />
              <RequestRowActions
                v-else
                :request="request"
                :can-manage="canManage"
                :can-self-fulfil="canSelfFulfil"
                :current-user-id="currentUserId"
                :busy="busyIds.has(request.id)"
                @open="handleOpen"
                @approve="handleApprove"
                @reject="handleReject"
                @grab="handleGrab"
                @dismiss="handleDismiss"
                @restore="handleRestore"
                @cancel="handleCancel"
                @remove="handleRemove"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Below `lg` the same rows stack. Same data, same actions, no second component to keep in step. -->
    <ul class="divide-y divide-border/60 lg:hidden">
      <li v-for="request in requests" :key="request.id" class="p-3" :class="rowDismissed(request) && 'opacity-60'">
        <div class="flex min-w-0 gap-3">
          <input
            v-if="isSelectable(request)"
            type="checkbox"
            class="mt-1 h-3.5 w-3.5 shrink-0 rounded-xs border-border accent-primary"
            :checked="isSelected(request)"
            :aria-label="t('bookRequests.table.selectRow', { title: request.title })"
            @change="handleToggleSelect(request)"
          />
          <RequestPairCover
            v-if="isPair(request)"
            :ebook-src="halfCover(request, 'ebook')"
            :audio-src="halfCover(request, 'audiobook')"
            :ebook-fallbacks="halfBookCovers(request, 'ebook')"
            :audio-fallbacks="halfBookCovers(request, 'audiobook')"
            class="me-1.5 h-[54px] w-9"
            :icon-size="16"
          />
          <RequestCover
            v-else
            :src="request.coverUrl"
            :fallback-sources="requestBookCoverSources(request)"
            :media-kind="request.mediaKind"
            class="h-[54px] w-9"
            :icon-size="16"
          />

          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="flex min-w-0 items-center gap-2">
              <button
                type="button"
                class="min-w-0 truncate text-start font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                @click="handleOpen(request)"
              >
                {{ request.title }}
              </button>
              <RouterLink
                v-if="landedBookId(request) !== null"
                :to="{ name: 'book-detail', params: { bookId: landedBookId(request) } }"
                class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                :title="t('book.actions.bookDetails')"
              >
                <ExternalLink :size="14" aria-hidden="true" />
                <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
              </RouterLink>
            </div>
            <p v-if="authorLine(request)" class="truncate text-xs text-muted-foreground">{{ authorLine(request) }}</p>

            <!-- A pair stacks one line per half: the medium, its stage, and what is happening to it. -->
            <template v-if="isPair(request)">
              <div v-for="half in orderedHalves(request)" :key="half.id" class="flex min-w-0 flex-wrap items-center gap-2">
                <component :is="mediaIcon(half)" :size="14" :class="mediaColor(half)" aria-hidden="true" />
                <span class="sr-only">{{ mediaLabel(half) }}</span>
                <RequestStatusBadge :status="statusFor(half)" />
                <span v-if="outcomeFor(half).kind === 'progress'" class="text-xs text-muted-foreground tabular-nums">{{ percentLabel(half) }}</span>
                <span
                  v-else-if="failureFor(half)"
                  class="min-w-0 truncate text-xs"
                  :class="isFailure(half) ? 'text-destructive' : 'text-muted-foreground'"
                >
                  {{ failureFor(half) }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('bookRequests.card.requestedByAt', { name: request.requesterName, time: formatRelativeFromNow(new Date(request.createdAt)) }) }}
              </p>
            </template>

            <div v-else class="flex flex-wrap items-center gap-2">
              <RequestStatusBadge :status="statusFor(request)" />
              <span
                v-if="request.selfServe"
                class="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
                :title="t('bookRequests.selfServeBadgeHint')"
              >
                <Zap :size="11" aria-hidden="true" />
                {{ t('bookRequests.selfServeBadge') }}
              </span>
              <span class="inline-flex" :title="mediaLabel(request)">
                <component :is="mediaIcon(request)" :size="15" :class="mediaColor(request)" aria-hidden="true" />
                <span class="sr-only">{{ mediaLabel(request) }}</span>
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('bookRequests.card.requestedByAt', { name: request.requesterName, time: formatRelativeFromNow(new Date(request.createdAt)) }) }}
              </span>
            </div>

            <!--
              A reason is no longer proof of a failure. Automation now hands a request back with one
              written on it while the row sits at `approved`, and rendering that in alarm red under a
              blue chip says two different things about the same row.
            -->
            <template v-if="isPair(request)" />
            <p
              v-else-if="failureFor(request)"
              class="flex items-start gap-1.5 text-xs"
              :class="isFailure(request) ? 'text-destructive' : 'text-muted-foreground'"
            >
              <TriangleAlert v-if="isFailure(request)" :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />
              <span class="line-clamp-2">{{ failureFor(request) }}</span>
            </p>
            <p v-else-if="outcomeFor(request).kind === 'progress'" class="text-xs text-muted-foreground tabular-nums">
              {{ percentLabel(request) }}
              <template v-if="transferLine(request)">&middot; {{ transferLine(request) }}</template>
            </p>
            <p v-else class="text-xs text-muted-foreground">
              {{ t(`bookRequests.outcome.${outcomeFor(request).key}`, outcomeFor(request).params ?? {}) }}
            </p>
          </div>

          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <RequestPairRowActions
              v-if="isPair(request)"
              :row="request"
              :can-manage="canManage"
              :can-self-fulfil="canSelfFulfil"
              :current-user-id="currentUserId"
              :busy="isRowBusy(request)"
              @open="handleOpen"
              @grab="handleGrab"
              @approve="handlePairApprove"
              @reject="handlePairReject"
              @cancel="handlePairCancel"
              @dismiss="handlePairDismiss"
              @restore="handlePairRestore"
            />
            <RequestRowActions
              v-else
              :request="request"
              :can-manage="canManage"
              :can-self-fulfil="canSelfFulfil"
              :current-user-id="currentUserId"
              :busy="busyIds.has(request.id)"
              @open="handleOpen"
              @approve="handleApprove"
              @reject="handleReject"
              @grab="handleGrab"
              @dismiss="handleDismiss"
              @restore="handleRestore"
              @cancel="handleCancel"
              @remove="handleRemove"
            />
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
