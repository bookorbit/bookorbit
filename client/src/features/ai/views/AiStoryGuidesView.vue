<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, ChevronLeft, ChevronRight, Search, X } from '@lucide/vue'
import { Permission, type StoryGuideListItem, type StoryGuideListSort, type StoryGuideModelHistory } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { buildStoryGuide, deleteStoryGuide } from '@/features/story-guide/api/story-guide.api'
import { formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import { formatBytes } from '@/lib/formatting'
import AiStoryGuideRow from '../components/AiStoryGuideRow.vue'
import AiStoryGuideSpeeds from '../components/AiStoryGuideSpeeds.vue'
import AiStoryGuidesData from '../components/AiStoryGuidesData.vue'
import { STORY_GUIDE_PAGE_SIZE, useStoryGuideShelf } from '../composables/useStoryGuideShelf'
import { formatAiDollars, formatBuildTime, modelPairLabel } from '../lib/ai-format'

interface Column {
  id: string
  sort: StoryGuideListSort | null
  class: string
  end?: boolean
}

const COLUMNS: readonly Column[] = [
  { id: 'book', sort: 'title', class: 'w-[40%] ps-3 max-lg:w-full' },
  { id: 'built', sort: 'built', class: 'max-sm:hidden' },
  { id: 'models', sort: null, class: 'w-[24%] max-lg:hidden' },
  { id: 'time', sort: 'time', class: 'max-md:hidden', end: true },
  { id: 'cost', sort: 'cost', class: 'max-md:hidden', end: true },
  { id: 'size', sort: 'size', class: 'max-xl:hidden', end: true },
]

const { t } = useI18n()
const { hasPermission } = usePermissions()
const shelf = useStoryGuideShelf()
const { query, sort, direction, offset, items, total, loading, failed, searching, summary, history, overviewLoading, overviewFailed } = shelf

const canAct = computed(() => hasPermission(Permission.LibraryGenerateStoryGuide))
const pageEnd = computed(() => Math.min(total.value, offset.value + items.value.length))
const hasPrevious = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + STORY_GUIDE_PAGE_SIZE < total.value)
const showPager = computed(() => total.value > STORY_GUIDE_PAGE_SIZE)
const models = computed<StoryGuideModelHistory[]>(() => history.value?.models ?? [])

const tiles = computed(() => [
  { id: 'stored', value: summary.value ? formatNumber(summary.value.count) : null },
  { id: 'storage', value: summary.value ? formatBytes(summary.value.bytes) : null },
  { id: 'spent', value: history.value ? formatAiDollars(history.value.cost) : null },
  {
    id: 'typical',
    value: history.value
      ? history.value.medianSeconds === null
        ? t('aiArea.storyGuides.overview.notTimed')
        : formatBuildTime(history.value.medianSeconds)
      : null,
  },
])

const rebuilding = ref<StoryGuideListItem | null>(null)
const deleting = ref<StoryGuideListItem | null>(null)
const busy = ref(false)
const rebuildOpen = computed(() => rebuilding.value !== null)
const deleteOpen = computed(() => deleting.value !== null)

function guideName(item: StoryGuideListItem | null): string {
  return item?.title ?? t('aiArea.storyGuides.list.noBook')
}

const rebuildBody = computed(() => {
  const item = rebuilding.value
  if (item?.cost != null) return t('aiArea.storyGuides.rebuild.bodyCost', { name: guideName(item), cost: formatAiDollars(item.cost) })
  return t('aiArea.storyGuides.rebuild.body', { name: guideName(item) })
})

function columnLabel(column: Column): string {
  return t(`aiArea.storyGuides.columns.${column.id}`)
}

function ariaSort(column: Column): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sort) return undefined
  if (sort.value !== column.sort) return 'none'
  return direction.value === 'asc' ? 'ascending' : 'descending'
}

function sortIcon(column: Column) {
  if (sort.value !== column.sort) return ArrowUpDown
  return direction.value === 'asc' ? ArrowUp : ArrowDown
}

function handleSort(column: Column) {
  if (column.sort) shelf.sortBy(column.sort)
}

function modelsLabel(entry: StoryGuideModelHistory): string {
  return modelPairLabel(entry.fast, entry.careful) ?? t('aiArea.storyGuides.models.unknown')
}

function modelKey(entry: StoryGuideModelHistory): string {
  return `${entry.fast ?? ''}|${entry.careful ?? ''}`
}

function averageTime(entry: StoryGuideModelHistory): string {
  return entry.averageSeconds === null ? '' : formatBuildTime(entry.averageSeconds)
}

function averageCost(entry: StoryGuideModelHistory): string {
  return entry.averageCost === null ? '' : formatAiDollars(entry.averageCost)
}

function previousPage() {
  offset.value = Math.max(0, offset.value - STORY_GUIDE_PAGE_SIZE)
}

function nextPage() {
  offset.value += STORY_GUIDE_PAGE_SIZE
}

function clearSearch() {
  shelf.clearSearch()
}

function retryList() {
  void shelf.load()
}

function retryOverview() {
  void shelf.loadOverview()
}

function startRebuild(item: StoryGuideListItem) {
  rebuilding.value = item
}

function startDelete(item: StoryGuideListItem) {
  deleting.value = item
}

function closeRebuild() {
  rebuilding.value = null
}

function closeDelete() {
  deleting.value = null
}

async function confirmRebuild() {
  const item = rebuilding.value
  if (!item || item.bookId === null) return
  busy.value = true
  try {
    const status = await buildStoryGuide(item.bookId, item.fileId, 'rebuild')
    if (status.job) toast.success(t('aiArea.storyGuides.rebuild.queued', { name: guideName(item) }))
    else toast.error(t('aiArea.storyGuides.rebuild.refused', { name: guideName(item) }))
    rebuilding.value = null
  } catch (reason) {
    toast.error(errorMessage(reason, 'aiArea.storyGuides.rebuild.failed'))
  } finally {
    busy.value = false
  }
}

async function confirmDelete() {
  const item = deleting.value
  if (!item || item.bookId === null) return
  busy.value = true
  try {
    await deleteStoryGuide(item.bookId, item.fileId, 'keep')
    toast.success(t('aiArea.storyGuides.delete.done', { name: guideName(item) }))
    deleting.value = null
    shelf.refresh()
  } catch (reason) {
    toast.error(errorMessage(reason, 'aiArea.storyGuides.delete.failed'))
  } finally {
    busy.value = false
  }
}

function handleAllDeleted() {
  shelf.refresh()
}
</script>

<template>
  <section class="flex max-w-5xl flex-col gap-4" aria-labelledby="ai-story-guides-title">
    <h2 id="ai-story-guides-title" class="sr-only">{{ t('aiArea.sections.storyGuides') }}</h2>

    <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="ai-story-guides-overview">
      <div v-for="tile in tiles" :key="tile.id" class="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
        <dt class="text-xs text-muted-foreground">{{ t(`aiArea.storyGuides.overview.${tile.id}`) }}</dt>
        <dd class="mt-1 text-xl font-semibold text-foreground tabular-nums" :data-testid="`ai-story-guides-${tile.id}`">
          <Skeleton v-if="tile.value === null && overviewLoading" class="h-7 w-16" />
          <span v-else-if="tile.value === null" class="text-sm font-normal text-muted-foreground">{{
            t('aiArea.storyGuides.overview.unknown')
          }}</span>
          <template v-else>{{ tile.value }}</template>
        </dd>
      </div>
    </dl>
    <p v-if="overviewFailed" class="text-xs text-muted-foreground" role="alert">
      {{ t('aiArea.storyGuides.overview.loadFailed') }}
      <button
        type="button"
        class="ms-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        @click="retryOverview"
      >
        {{ t('common.retry') }}
      </button>
    </p>

    <section class="overflow-hidden rounded-xl border border-border bg-card shadow-xs" aria-labelledby="ai-story-guides-list-title">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 id="ai-story-guides-list-title" class="text-sm font-semibold text-foreground">{{ t('aiArea.storyGuides.list.title') }}</h3>
        <div class="relative w-full sm:w-64">
          <Search class="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            v-model="query"
            type="search"
            class="h-8 ps-8 text-sm"
            :placeholder="t('aiArea.storyGuides.list.search')"
            :aria-label="t('aiArea.storyGuides.list.search')"
            data-testid="ai-story-guides-search"
          />
        </div>
      </div>

      <div v-if="loading" class="divide-y divide-border" role="status" :aria-label="t('aiArea.storyGuides.list.loading')">
        <div v-for="index in 4" :key="index" class="flex items-center gap-2.5 px-3 py-2">
          <Skeleton class="h-9 w-6 shrink-0 rounded-xs" />
          <div class="flex-1 space-y-1.5">
            <Skeleton class="h-3.5 w-2/5" />
            <Skeleton class="h-3 w-1/4" />
          </div>
        </div>
      </div>

      <p v-else-if="failed && items.length === 0" class="px-4 py-6 text-sm text-foreground" role="alert">
        {{ t('aiArea.storyGuides.list.loadFailed') }}
        <button
          type="button"
          class="ms-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          @click="retryList"
        >
          {{ t('common.retry') }}
        </button>
      </p>

      <div v-else-if="items.length === 0" class="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="ai-story-guides-empty">
        <span class="grid size-11 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
          <component :is="searching ? Search : BookOpen" class="size-5" />
        </span>
        <p class="text-sm font-medium text-foreground">
          {{ searching ? t('aiArea.storyGuides.list.noMatch') : t('aiArea.storyGuides.list.empty') }}
        </p>
        <p v-if="!searching" class="max-w-sm text-sm text-muted-foreground">{{ t('aiArea.storyGuides.list.emptyHint') }}</p>
        <Button v-else variant="outline" size="sm" @click="clearSearch">
          <X class="size-3.5" aria-hidden="true" />
          {{ t('aiArea.storyGuides.list.clearSearch') }}
        </Button>
      </div>

      <table v-else class="w-full border-collapse text-start">
        <thead class="border-b border-border bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th
              v-for="column in COLUMNS"
              :key="column.id"
              scope="col"
              class="py-1 pe-3 font-medium whitespace-nowrap"
              :class="[column.class, column.end ? 'text-end' : 'text-start']"
              :aria-sort="ariaSort(column)"
            >
              <button
                v-if="column.sort"
                type="button"
                class="-mx-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs font-medium transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :class="sort === column.sort ? 'text-foreground' : 'text-muted-foreground'"
                :data-testid="`ai-story-guides-sort-${column.sort}`"
                @click="handleSort(column)"
              >
                {{ columnLabel(column) }}
                <component :is="sortIcon(column)" class="size-3" aria-hidden="true" />
              </button>
              <span v-else>{{ columnLabel(column) }}</span>
            </th>
            <th scope="col" class="w-px py-1 pe-2 font-medium">
              <span class="sr-only">{{ t('aiArea.storyGuides.columns.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <AiStoryGuideRow
            v-for="item in items"
            :key="item.key"
            :item="item"
            :can-act="canAct"
            :busy="busy"
            @rebuild="startRebuild"
            @delete="startDelete"
          />
        </tbody>
      </table>
    </section>

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

    <section
      v-if="models.length > 0"
      class="overflow-hidden rounded-xl border border-border bg-card shadow-xs"
      aria-labelledby="ai-story-guides-models-title"
      data-testid="ai-story-guides-models"
    >
      <div class="space-y-0.5 border-b border-border px-4 py-3">
        <h3 id="ai-story-guides-models-title" class="text-sm font-semibold text-foreground">{{ t('aiArea.storyGuides.models.title') }}</h3>
        <p class="text-xs text-muted-foreground">{{ t('aiArea.storyGuides.models.brief') }}</p>
      </div>
      <table class="w-full border-collapse text-start">
        <thead class="border-b border-border bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" class="w-full py-2 ps-4 pe-3 text-start font-medium">{{ t('aiArea.storyGuides.models.columns.models') }}</th>
            <th scope="col" class="py-2 pe-3 text-end font-medium whitespace-nowrap">{{ t('aiArea.storyGuides.models.columns.builds') }}</th>
            <th scope="col" class="py-2 pe-3 text-end font-medium whitespace-nowrap">{{ t('aiArea.storyGuides.models.columns.time') }}</th>
            <th scope="col" class="py-2 pe-4 text-end font-medium whitespace-nowrap">{{ t('aiArea.storyGuides.models.columns.cost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in models" :key="modelKey(entry)" class="border-t border-border first:border-t-0" data-testid="ai-story-guides-model">
            <td class="max-w-0 py-2 ps-4 pe-3 text-sm text-foreground">
              <span class="block truncate" :title="modelsLabel(entry)">{{ modelsLabel(entry) }}</span>
            </td>
            <td class="py-2 pe-3 text-end text-xs text-muted-foreground tabular-nums">{{ formatNumber(entry.builds) }}</td>
            <td class="py-2 pe-3 text-end text-xs whitespace-nowrap text-muted-foreground tabular-nums">{{ averageTime(entry) }}</td>
            <td class="py-2 pe-4 text-end text-xs whitespace-nowrap text-muted-foreground tabular-nums">{{ averageCost(entry) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
      <AiStoryGuideSpeeds />
      <AiStoryGuidesData @deleted="handleAllDeleted" />
    </div>

    <ConfirmDialog
      :open="rebuildOpen"
      :title="t('aiArea.storyGuides.rebuild.title')"
      :description="rebuildBody"
      :confirm-label="t('aiArea.storyGuides.rebuild.confirm')"
      :destructive="false"
      :busy="busy"
      @confirm="confirmRebuild"
      @cancel="closeRebuild"
    />
    <ConfirmDialog
      :open="deleteOpen"
      :title="t('aiArea.storyGuides.delete.title')"
      :description="t('aiArea.storyGuides.delete.body', { name: guideName(deleting) })"
      :confirm-label="t('aiArea.storyGuides.delete.confirm')"
      :busy="busy"
      @confirm="confirmDelete"
      @cancel="closeDelete"
    />
  </section>
</template>
