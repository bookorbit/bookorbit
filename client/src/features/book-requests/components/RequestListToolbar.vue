<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { Rows3, Rows4, Search, SlidersHorizontal, X } from '@lucide/vue'
import {
  BOOK_REQUEST_MEDIA_KINDS,
  BOOK_REQUEST_SEARCH_MAX_LENGTH,
  BOOK_REQUEST_SORT_FIELDS,
  BOOK_REQUEST_STATUSES,
  BOOK_REQUEST_VIEW_STATUSES,
} from '@bookorbit/types'
import type { BookRequestRequesterOption, BookRequestStatus, BookRequestViewCounts } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber } from '@/i18n/formatters'
import type { RequestListDensity } from '../composables/useRequestListDensity'
import {
  activeFilterCount,
  DEFAULT_LIST_STATE,
  defaultSortDirection,
  REQUEST_LIST_VIEWS,
  type RequestApprovalFilter,
  type RequestListState,
  type RequestListView,
} from '../requestListQuery'

const SEARCH_DEBOUNCE_MS = 300

const props = defineProps<{
  state: RequestListState
  counts: BookRequestViewCounts | null
  showRequester: boolean
  requesterOptions: BookRequestRequesterOption[]
  density: RequestListDensity
}>()

const emit = defineEmits<{
  change: [patch: Partial<RequestListState>]
  'update:density': [density: RequestListDensity]
}>()

const { t } = useI18n()
const isNarrow = useMediaQuery('(max-width: 767px)')

const filtersOpen = ref(false)
const search = ref(props.state.q)
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** A Back or a "Clear all" changes the query under the box, and the box follows it. */
watch(
  () => props.state.q,
  (q) => {
    if (q !== search.value.trim()) search.value = q
  },
)

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function handleSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(commitSearch, SEARCH_DEBOUNCE_MS)
}

function commitSearch() {
  searchTimer = null
  const q = search.value.trim()
  if (q !== props.state.q) emit('change', { q })
}

const filterCount = computed(() => activeFilterCount(props.state))

function viewCount(view: RequestListView): number | null {
  if (!props.counts) return null
  return view === 'all' ? props.counts.active : props.counts[view]
}

/** A view that holds a fixed set of statuses offers only those; "All" and "Hidden" can hold any. */
function viewStatuses(view: RequestListView): readonly BookRequestStatus[] {
  return view === 'all' || view === 'hidden' ? BOOK_REQUEST_STATUSES : BOOK_REQUEST_VIEW_STATUSES[view]
}

const statusOptions = computed(() => viewStatuses(props.state.view))

function selectView(view: RequestListView) {
  if (view === props.state.view) return
  const status = props.state.status
  emit('change', status && !viewStatuses(view).includes(status) ? { view, status: '' } : { view })
}

function countClass(view: RequestListView): string {
  if (props.state.view === view) return 'bg-primary/15 text-primary'
  if (view === 'needs_action' && (viewCount(view) ?? 0) > 0) return 'bg-warning/15 text-warning'
  return 'bg-foreground/8 text-muted-foreground'
}

const requesterName = computed(() => {
  const option = props.requesterOptions.find((requester) => requester.userId === props.state.requester)
  return option?.name ?? String(props.state.requester)
})

function approvalLabel(value: RequestApprovalFilter): string {
  if (value === 'needed') return t('bookRequests.filterMenu.approvalNeeded')
  if (value === 'skipped') return t('bookRequests.filterMenu.approvalSkipped')
  return t('bookRequests.filterMenu.approvalAny')
}

function handleStatus(event: Event) {
  emit('change', { status: (event.target as HTMLSelectElement).value as RequestListState['status'] })
}

function handleFormat(event: Event) {
  emit('change', { format: (event.target as HTMLSelectElement).value as RequestListState['format'] })
}

function handleRequester(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('change', { requester: value === '' ? '' : Number(value) })
}

function handleApproval(event: Event) {
  emit('change', { approval: (event.target as HTMLSelectElement).value as RequestApprovalFilter })
}

function handleSort(event: Event) {
  const sort = (event.target as HTMLSelectElement).value as RequestListState['sort']
  emit('change', { sort, dir: defaultSortDirection(sort) })
}

function handleDirection(event: Event) {
  emit('change', { dir: (event.target as HTMLSelectElement).value as RequestListState['dir'] })
}

function clearStatus() {
  emit('change', { status: '' })
}

function clearFormat() {
  emit('change', { format: '' })
}

function clearRequester() {
  emit('change', { requester: '' })
}

function clearApproval() {
  emit('change', { approval: '' })
}

function clearFilters() {
  emit('change', { status: '', format: '', requester: '', approval: '' })
}

function clearAndClose() {
  clearFilters()
  filtersOpen.value = false
}

function closeFilters() {
  filtersOpen.value = false
}

function toggleDensity() {
  emit('update:density', props.density === 'compact' ? 'comfortable' : 'compact')
}

const LABEL = 'mb-1 block text-xs font-medium text-muted-foreground'
const SELECT = 'select-field h-8 w-full px-2 text-[13px]'
const CHIP =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-card ps-2.5 pe-2 text-[13px] font-medium text-foreground hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
</script>

<template>
  <div class="space-y-2.5">
    <div class="flex flex-wrap items-center gap-2">
      <label class="relative block min-w-0 flex-1 basis-56">
        <span class="sr-only">{{ t('bookRequests.listSearch.label') }}</span>
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="search"
          type="search"
          class="input-field h-9 w-full ps-9 pe-3"
          :maxlength="BOOK_REQUEST_SEARCH_MAX_LENGTH"
          :placeholder="isNarrow ? t('bookRequests.listSearch.placeholderShort') : t('bookRequests.listSearch.placeholder')"
          @input="handleSearchInput"
          @keydown.enter="commitSearch"
        />
      </label>

      <div
        role="group"
        :aria-label="t('bookRequests.views.label')"
        class="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted p-0.5 [scrollbar-width:none] max-lg:order-last max-lg:basis-full"
      >
        <template v-for="view in REQUEST_LIST_VIEWS" :key="view">
          <span v-if="view === 'hidden'" class="mx-0.5 my-1.5 w-px shrink-0 bg-border" aria-hidden="true" />
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none max-lg:flex-1 max-lg:justify-center"
            :class="state.view === view ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="state.view === view"
            @click="selectView(view)"
          >
            {{ t(`bookRequests.views.${view}`) }}
            <span v-if="viewCount(view) !== null" class="min-w-4 rounded-xs px-1 text-center text-xs tabular-nums" :class="countClass(view)">
              {{ formatNumber(viewCount(view) ?? 0) }}
            </span>
          </button>
        </template>
      </div>

      <Popover v-model:open="filtersOpen">
        <PopoverTrigger as-child>
          <Button
            variant="outline"
            type="button"
            class="h-9 gap-1.5 px-2.5"
            :class="filterCount > 0 ? 'border-primary/45 text-primary hover:text-primary' : ''"
            :aria-label="t('bookRequests.filterMenu.button')"
          >
            <SlidersHorizontal :size="15" aria-hidden="true" />
            <span class="max-sm:sr-only">{{ t('bookRequests.filterMenu.button') }}</span>
            <span v-if="filterCount > 0" class="rounded-xs bg-primary/15 px-1 text-xs text-primary tabular-nums">{{ filterCount }}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-80 max-w-[calc(100vw-2rem)] p-3">
          <div class="grid grid-cols-2 gap-x-2.5 gap-y-3">
            <div class="col-span-2">
              <label for="requests-filter-status" :class="LABEL">{{ t('bookRequests.filterMenu.status') }}</label>
              <select id="requests-filter-status" :class="SELECT" :value="state.status" @change="handleStatus">
                <option value="">{{ t('bookRequests.filters.anyStatus') }}</option>
                <option v-for="status in statusOptions" :key="status" :value="status">{{ t(`bookRequests.status.${status}`) }}</option>
              </select>
            </div>
            <div>
              <label for="requests-filter-format" :class="LABEL">{{ t('bookRequests.filterMenu.format') }}</label>
              <select id="requests-filter-format" :class="SELECT" :value="state.format" @change="handleFormat">
                <option value="">{{ t('bookRequests.filters.anyMediaKind') }}</option>
                <option v-for="kind in BOOK_REQUEST_MEDIA_KINDS" :key="kind" :value="kind">{{ t(`bookRequests.mediaKind.${kind}`) }}</option>
              </select>
            </div>
            <div>
              <label for="requests-filter-approval" :class="LABEL">{{ t('bookRequests.filterMenu.approval') }}</label>
              <select id="requests-filter-approval" :class="SELECT" :value="state.approval" @change="handleApproval">
                <option value="">{{ t('bookRequests.filterMenu.approvalAny') }}</option>
                <option value="needed">{{ t('bookRequests.filterMenu.approvalNeeded') }}</option>
                <option value="skipped">{{ t('bookRequests.filterMenu.approvalSkipped') }}</option>
              </select>
            </div>
            <div v-if="showRequester" class="col-span-2">
              <label for="requests-filter-requester" :class="LABEL">{{ t('bookRequests.filterMenu.requester') }}</label>
              <select id="requests-filter-requester" :class="SELECT" :value="state.requester" @change="handleRequester">
                <option value="">{{ t('bookRequests.filters.anyRequester') }}</option>
                <option v-for="requester in requesterOptions" :key="requester.userId" :value="requester.userId">
                  {{ requester.name }} (@{{ requester.username }})
                </option>
              </select>
            </div>
            <div class="col-span-2 -mx-3 h-px bg-border" />
            <div>
              <label for="requests-filter-sort" :class="LABEL">{{ t('bookRequests.filterMenu.sort') }}</label>
              <select id="requests-filter-sort" :class="SELECT" :value="state.sort" @change="handleSort">
                <option v-for="field in BOOK_REQUEST_SORT_FIELDS" :key="field" :value="field">
                  {{ t(`bookRequests.filterMenu.sortFields.${field}`) }}
                </option>
              </select>
            </div>
            <div>
              <label for="requests-filter-direction" :class="LABEL">{{ t('bookRequests.filterMenu.direction') }}</label>
              <select id="requests-filter-direction" :class="SELECT" :value="state.dir" @change="handleDirection">
                <option value="asc">{{ t('bookRequests.filterMenu.directions.asc') }}</option>
                <option value="desc">{{ t('bookRequests.filterMenu.directions.desc') }}</option>
              </select>
            </div>
          </div>
          <div class="-mx-3 mt-3 flex justify-end gap-2 border-t border-border px-3 pt-2.5">
            <Button variant="ghost" size="sm" type="button" :disabled="filterCount === 0" @click="clearAndClose">{{
              t('bookRequests.filterMenu.clear')
            }}</Button>
            <Button size="sm" type="button" @click="closeFilters">{{ t('bookRequests.filterMenu.done') }}</Button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="icon"
        type="button"
        class="hidden xl:inline-flex"
        :class="density === 'compact' && 'border-primary/45 text-primary hover:text-primary'"
        :aria-pressed="density === 'compact'"
        :aria-label="t('bookRequests.densityToggle.compact')"
        :title="t('bookRequests.densityToggle.compact')"
        @click="toggleDensity"
      >
        <component :is="density === 'compact' ? Rows4 : Rows3" :size="16" aria-hidden="true" />
      </Button>
    </div>

    <div v-if="filterCount > 0" class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="t('bookRequests.activeFilters.label')">
      <button
        v-if="state.status !== DEFAULT_LIST_STATE.status"
        type="button"
        :class="CHIP"
        :aria-label="t('bookRequests.activeFilters.remove', { value: t(`bookRequests.status.${state.status}`) })"
        @click="clearStatus"
      >
        <span class="truncate">{{ t('bookRequests.activeFilters.status', { value: t(`bookRequests.status.${state.status}`) }) }}</span>
        <X :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        v-if="state.format !== DEFAULT_LIST_STATE.format"
        type="button"
        :class="CHIP"
        :aria-label="t('bookRequests.activeFilters.remove', { value: t(`bookRequests.mediaKind.${state.format}`) })"
        @click="clearFormat"
      >
        <span class="truncate">{{ t('bookRequests.activeFilters.format', { value: t(`bookRequests.mediaKind.${state.format}`) }) }}</span>
        <X :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        v-if="state.requester !== DEFAULT_LIST_STATE.requester"
        type="button"
        :class="CHIP"
        :aria-label="t('bookRequests.activeFilters.remove', { value: requesterName })"
        @click="clearRequester"
      >
        <span class="truncate">{{ t('bookRequests.activeFilters.requester', { value: requesterName }) }}</span>
        <X :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        v-if="state.approval !== DEFAULT_LIST_STATE.approval"
        type="button"
        :class="CHIP"
        :aria-label="t('bookRequests.activeFilters.remove', { value: approvalLabel(state.approval) })"
        @click="clearApproval"
      >
        <span class="truncate">{{ t('bookRequests.activeFilters.approval', { value: approvalLabel(state.approval) }) }}</span>
        <X :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="rounded-sm px-1.5 text-[13px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        @click="clearFilters"
      >
        {{ t('bookRequests.activeFilters.clearAll') }}
      </button>
    </div>
  </div>
</template>
