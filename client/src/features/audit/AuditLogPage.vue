<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import type { AuditLogEntry } from '@bookorbit/types'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw, Search, SlidersHorizontal, X } from '@lucide/vue'
import { formatDateTime, formatRelativeTime } from '@/i18n/formatters'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import AuditActionPicker from './AuditActionPicker.vue'
import AuditActorPicker from './AuditActorPicker.vue'
import AuditCategoryBadge from './AuditCategoryBadge.vue'
import AuditEntryDetails from './AuditEntryDetails.vue'
import AuditResourcePicker from './AuditResourcePicker.vue'
import { getAuditActionLabelKey } from './audit-actions'
import { getAuditCategory, getAuditTarget } from './audit-display'
import { getBookDeletionAuditMeta } from './audit-meta'
import { getAuditResourceBadgeClass, getAuditResourceLabelKey } from './audit-resources'
import { useAuditLog } from './useAuditLog'

type FilterKey = 'search' | 'action' | 'actorUsername' | 'resource' | 'dateFrom' | 'dateTo'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const { t } = useI18n()
const { entries, actors, total, page, pageSize, loading, error, filters, fetchPage, fetchActors, applyFilters, clearFilters, goToPage } =
  useAuditLog()

const totalPages = computed(() => Math.ceil(total.value / pageSize))
const isMobile = useMediaQuery('(max-width: 767px)')
const filtersOpen = ref(true)
const expandedDetailsIds = ref<number[]>([])
const currentTime = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined

const activeFilterChips = computed(() => {
  const chips: { key: FilterKey; label: string; toneClass?: string }[] = []
  if (filters.search) chips.push({ key: 'search', label: t('audit.chips.search', { value: filters.search }) })
  if (filters.action) chips.push({ key: 'action', label: t('audit.chips.eventType', { value: t(getAuditActionLabelKey(filters.action)) }) })
  if (filters.actorUsername) chips.push({ key: 'actorUsername', label: t('audit.chips.actor', { value: filters.actorUsername }) })
  if (filters.resource) {
    chips.push({
      key: 'resource',
      label: t('audit.chips.targetType', { value: t(getAuditResourceLabelKey(filters.resource)) }),
      toneClass: getAuditResourceBadgeClass(filters.resource),
    })
  }
  if (filters.dateFrom) chips.push({ key: 'dateFrom', label: t('audit.chips.from', { value: filters.dateFrom }) })
  if (filters.dateTo) chips.push({ key: 'dateTo', label: t('audit.chips.to', { value: filters.dateTo }) })
  return chips
})

const hasFilters = computed(() => activeFilterChips.value.length > 0)

function relativeTimestamp(value: string): string {
  const differenceMs = new Date(value).getTime() - currentTime.value
  const absoluteMs = Math.abs(differenceMs)
  if (absoluteMs < 60_000) return formatRelativeTime(Math.round(differenceMs / 1000), 'second')
  if (absoluteMs < 3_600_000) return formatRelativeTime(Math.round(differenceMs / 60_000), 'minute')
  if (absoluteMs < 86_400_000) return formatRelativeTime(Math.round(differenceMs / 3_600_000), 'hour')
  if (absoluteMs < 2_592_000_000) return formatRelativeTime(Math.round(differenceMs / 86_400_000), 'day')
  if (absoluteMs < 31_536_000_000) return formatRelativeTime(Math.round(differenceMs / 2_592_000_000), 'month')
  return formatRelativeTime(Math.round(differenceMs / 31_536_000_000), 'year')
}

function exactTimestamp(value: string): string {
  return formatDateTime(new Date(value))
}

function targetSummary(entry: AuditLogEntry): string {
  return getAuditTarget(
    entry,
    t('audit.untitledBook'),
    (count) => t('audit.targetAdditional', { count }),
    (resource) => t(getAuditResourceLabelKey(resource)),
  )
}

function impactSummary(entry: AuditLogEntry): string {
  const deletion = getBookDeletionAuditMeta(entry)
  return deletion ? t('audit.bookImpact', { count: deletion.total }) : '-'
}

function detailRegionId(entryId: number, layout: 'desktop' | 'mobile') {
  return `audit-entry-${entryId}-${layout}-details`
}

function toggleDetails(id: number) {
  expandedDetailsIds.value = expandedDetailsIds.value.includes(id)
    ? expandedDetailsIds.value.filter((entryId) => entryId !== id)
    : [...expandedDetailsIds.value, id]
}

function isDetailsOpen(id: number) {
  return expandedDetailsIds.value.includes(id)
}

function handleSearch() {
  void applyFilters()
}

function handleClear() {
  void clearFilters()
}

function handleRefresh() {
  void fetchPage()
}

function toggleFilters() {
  filtersOpen.value = !filtersOpen.value
}

function handlePreviousPage() {
  void goToPage(page.value - 1)
}

function handleNextPage() {
  void goToPage(page.value + 1)
}

function filterActor(entry: AuditLogEntry) {
  filters.actorUsername = entry.actorUsername
  handleSearch()
}

function removeFilter(key: FilterKey) {
  filters[key] = ''
  handleSearch()
}

function localDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function applyDatePreset(days: number) {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days + 1)
  filters.dateFrom = localDateValue(from)
  filters.dateTo = localDateValue(to)
  handleSearch()
}

function handleToday() {
  applyDatePreset(1)
}

function handleSevenDays() {
  applyDatePreset(7)
}

function handleThirtyDays() {
  applyDatePreset(30)
}

onMounted(() => {
  void Promise.all([fetchPage(), fetchActors()])
  clockTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 60_000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})

watch(
  isMobile,
  (mobile) => {
    filtersOpen.value = !mobile
  },
  { immediate: true },
)
</script>

<template>
  <SettingsPageHeader v-if="!props.embedded" class="hidden md:flex" :title="t('audit.pageTitle')" :subtitle="t('audit.pageSubtitle')" />
  <div v-if="!props.embedded" class="px-1 md:hidden">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('audit.pageTitle') }}</h1>
    <p class="mt-1 text-sm leading-5 text-muted-foreground">{{ t('audit.pageSubtitle') }}</p>
  </div>

  <div class="mt-5 space-y-4 md:mt-0">
    <section class="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <div>
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-controls="audit-filters"
          :aria-expanded="filtersOpen"
          @click="toggleFilters"
        >
          <div class="flex min-w-0 items-center gap-2">
            <SlidersHorizontal :size="15" class="text-muted-foreground" aria-hidden="true" />
            <p class="text-sm font-medium text-foreground">{{ t('audit.filters') }}</p>
            <span v-if="!hasFilters" class="text-xs text-muted-foreground">{{ t('audit.noActiveFilters') }}</span>
          </div>
          <ChevronUp v-if="filtersOpen" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <ChevronDown v-else :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <div v-if="hasFilters" class="flex flex-wrap gap-1.5 px-3 pb-2.5">
          <button
            v-for="chip in activeFilterChips"
            :key="chip.key"
            type="button"
            class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:text-foreground"
            :class="chip.toneClass ?? 'border-transparent bg-muted text-muted-foreground'"
            :aria-label="t('audit.removeFilter', { value: chip.label })"
            @click.stop="removeFilter(chip.key)"
          >
            {{ chip.label }}
            <X :size="11" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div v-if="filtersOpen" id="audit-filters" class="space-y-2.5 border-t border-border p-3">
        <div class="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <label for="audit-search" class="text-xs text-muted-foreground">{{ t('audit.filterLabels.search') }}</label>
            <div class="relative mt-1">
              <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                id="audit-search"
                v-model="filters.search"
                class="h-9 w-full rounded-md border border-input bg-background ps-9 pe-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                :placeholder="t('audit.filterPlaceholders.search')"
                @keydown.enter="handleSearch"
              />
            </div>
          </div>
          <div>
            <label for="audit-action" class="text-xs text-muted-foreground">{{ t('audit.filterLabels.eventType') }}</label>
            <AuditActionPicker id="audit-action" v-model="filters.action" />
          </div>
          <div>
            <label for="audit-actor" class="text-xs text-muted-foreground">{{ t('audit.filterLabels.actor') }}</label>
            <AuditActorPicker id="audit-actor" v-model="filters.actorUsername" :actors="actors" />
          </div>
          <div>
            <label for="audit-resource" class="text-xs text-muted-foreground">{{ t('audit.filterLabels.targetType') }}</label>
            <AuditResourcePicker id="audit-resource" v-model="filters.resource" />
          </div>
        </div>

        <div class="flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
          <div class="grid flex-1 gap-2.5 sm:grid-cols-2 xl:max-w-3xl xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <label for="audit-from" class="text-xs text-muted-foreground">{{ t('audit.filterLabels.from') }}</label>
              <input
                id="audit-from"
                v-model="filters.dateFrom"
                type="date"
                class="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label for="audit-to" class="text-xs text-muted-foreground">{{ t('audit.filterLabels.to') }}</label>
              <input
                id="audit-to"
                v-model="filters.dateTo"
                type="date"
                class="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <span class="text-xs text-muted-foreground">{{ t('audit.quickDates') }}</span>
              <div class="mt-1 flex gap-1">
                <button type="button" class="settings-btn-outline h-9 px-2.5" @click="handleToday">{{ t('audit.today') }}</button>
                <button type="button" class="settings-btn-outline h-9 px-2.5" @click="handleSevenDays">{{ t('audit.sevenDays') }}</button>
                <button type="button" class="settings-btn-outline h-9 px-2.5" @click="handleThirtyDays">{{ t('audit.thirtyDays') }}</button>
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            <button type="button" class="settings-btn-primary h-9" @click="handleSearch">
              <Search :size="14" aria-hidden="true" />
              {{ t('common.search') }}
            </button>
            <button v-if="hasFilters" type="button" class="settings-btn-outline h-9" @click="handleClear">
              <X :size="14" aria-hidden="true" />
              {{ t('audit.clear') }}
            </button>
            <button type="button" class="settings-btn-outline h-9 px-2.5" :aria-label="t('audit.refresh')" :disabled="loading" @click="handleRefresh">
              <RefreshCw :size="14" :class="{ 'animate-spin': loading }" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>

    <div class="hidden overflow-hidden rounded-lg border border-border shadow-xs md:block">
      <table class="w-full table-fixed text-sm">
        <thead class="sticky top-0 z-10 bg-muted/70 backdrop-blur">
          <tr>
            <th class="w-32 px-3 py-2.5 text-start font-medium text-muted-foreground">{{ t('audit.columns.when') }}</th>
            <th class="w-44 px-3 py-2.5 text-start font-medium text-muted-foreground">{{ t('audit.columns.actor') }}</th>
            <th class="hidden w-36 px-3 py-2.5 text-start font-medium text-muted-foreground xl:table-cell">{{ t('audit.detailCategory') }}</th>
            <th class="w-[38%] px-3 py-2.5 text-start font-medium text-muted-foreground xl:w-[30%]">{{ t('audit.columns.event') }}</th>
            <th class="px-3 py-2.5 text-start font-medium text-muted-foreground">{{ t('audit.columns.target') }}</th>
            <th class="w-24 px-3 py-2.5 text-start font-medium text-muted-foreground">{{ t('audit.columns.impact') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-if="loading">
            <td colspan="6" class="px-4 py-10 text-center text-muted-foreground">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td colspan="6" class="px-4 py-10 text-center text-muted-foreground">{{ t('audit.empty') }}</td>
          </tr>
          <template v-else v-for="entry in entries" :key="entry.id">
            <tr class="group transition-colors hover:bg-muted/30">
              <td class="px-3 py-2.5 text-xs text-muted-foreground">
                <time :datetime="entry.createdAt" :title="exactTimestamp(entry.createdAt)">{{ relativeTimestamp(entry.createdAt) }}</time>
              </td>
              <td class="px-3 py-2.5">
                <button
                  type="button"
                  class="max-w-28 truncate text-start text-xs font-medium text-foreground hover:text-primary hover:underline"
                  @click="filterActor(entry)"
                >
                  {{ entry.actorUsername }}
                </button>
                <span v-if="entry.userId !== null" class="ms-1 text-[11px] text-muted-foreground">{{
                  t('audit.userIdCompact', { id: entry.userId })
                }}</span>
              </td>
              <td class="hidden px-3 py-2.5 xl:table-cell">
                <AuditCategoryBadge :category="getAuditCategory(entry.action)" />
              </td>
              <td class="px-3 py-2.5">
                <div class="flex min-w-0 items-center gap-2">
                  <AuditCategoryBadge class="shrink-0 xl:hidden" :category="getAuditCategory(entry.action)" />
                  <p class="min-w-0 flex-1 truncate font-medium text-foreground" :title="entry.description">{{ entry.description }}</p>
                  <button
                    type="button"
                    class="shrink-0 rounded px-1.5 py-1 text-xs text-primary hover:bg-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :aria-expanded="isDetailsOpen(entry.id)"
                    :aria-controls="detailRegionId(entry.id, 'desktop')"
                    @click="toggleDetails(entry.id)"
                  >
                    {{ isDetailsOpen(entry.id) ? t('audit.hideDetails') : t('audit.details') }}
                  </button>
                </div>
              </td>
              <td class="px-3 py-2.5 text-sm text-muted-foreground">{{ targetSummary(entry) }}</td>
              <td class="px-3 py-2.5 text-xs font-medium text-foreground">{{ impactSummary(entry) }}</td>
            </tr>
            <tr v-if="isDetailsOpen(entry.id)">
              <td colspan="6" class="bg-muted/20 px-4 py-3">
                <AuditEntryDetails :id="detailRegionId(entry.id, 'desktop')" :entry="entry" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs md:hidden">
      <div v-if="loading" class="px-4 py-10 text-center text-sm text-muted-foreground">{{ t('common.loading') }}</div>
      <div v-else-if="entries.length === 0" class="px-4 py-10 text-center text-sm text-muted-foreground">{{ t('audit.empty') }}</div>
      <article v-else v-for="entry in entries" :key="entry.id" class="px-4 py-3">
        <div class="flex items-start justify-between gap-3">
          <AuditCategoryBadge :category="getAuditCategory(entry.action)" />
          <time :datetime="entry.createdAt" :title="exactTimestamp(entry.createdAt)" class="text-xs text-muted-foreground">
            {{ relativeTimestamp(entry.createdAt) }}
          </time>
        </div>
        <p class="mt-2 font-medium text-foreground">{{ entry.description }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ targetSummary(entry) }}</p>
        <div class="mt-2 flex items-center justify-between gap-3">
          <button type="button" class="text-xs font-medium text-foreground hover:text-primary hover:underline" @click="filterActor(entry)">
            {{ entry.actorUsername }}
          </button>
          <button
            type="button"
            class="text-xs text-primary hover:underline"
            :aria-expanded="isDetailsOpen(entry.id)"
            :aria-controls="detailRegionId(entry.id, 'mobile')"
            @click="toggleDetails(entry.id)"
          >
            {{ isDetailsOpen(entry.id) ? t('audit.hideDetails') : t('audit.details') }}
          </button>
        </div>
        <AuditEntryDetails v-if="isDetailsOpen(entry.id)" :id="detailRegionId(entry.id, 'mobile')" class="mt-2" :entry="entry" />
      </article>
    </div>

    <div v-if="totalPages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
      <span>{{ t('audit.showing', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total }) }}</span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="rounded p-1.5 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          :aria-label="t('audit.prev')"
          :disabled="page <= 1"
          @click="handlePreviousPage"
        >
          <ChevronLeft :size="16" aria-hidden="true" />
        </button>
        <span class="px-2">{{ page }} / {{ totalPages }}</span>
        <button
          type="button"
          class="rounded p-1.5 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          :aria-label="t('common.next')"
          :disabled="page >= totalPages"
          @click="handleNextPage"
        >
          <ChevronRight :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
