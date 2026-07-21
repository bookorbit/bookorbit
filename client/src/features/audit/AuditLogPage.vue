<script setup lang="ts">
import { onMounted, computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { RefreshCw, Search, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from '@lucide/vue'
import { AuditAction } from '@bookorbit/types'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { useAuditLog } from './useAuditLog'
import { useMediaQuery } from '@vueuse/core'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { entries, total, page, pageSize, loading, error, filters, fetchPage, applyFilters, clearFilters, goToPage } = useAuditLog()
const { t } = useI18n()

const totalPages = computed(() => Math.ceil(total.value / pageSize))
const hasFilters = computed(() => filters.action || filters.userId || filters.dateFrom || filters.dateTo)
const isMobile = useMediaQuery('(max-width: 767px)')
const filtersOpen = ref(true)
const expandedDetailsIds = ref<number[]>([])
const expandedTextIds = ref<number[]>([])

const activeFilterChips = computed(() => {
  const chips: string[] = []
  if (filters.action) chips.push(t('audit.chips.action', { value: filters.action }))
  if (filters.userId) chips.push(t('audit.chips.user', { value: filters.userId }))
  if (filters.dateFrom) chips.push(t('audit.chips.from', { value: filters.dateFrom }))
  if (filters.dateTo) chips.push(t('audit.chips.to', { value: filters.dateTo }))
  return chips
})

function formatDate(iso: string) {
  return formatLocaleDate(new Date(iso), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function isFailedAuth(action: string) {
  return action === AuditAction.AuthLoginFailed
}

function handleSearch() {
  applyFilters()
}

function handleClear() {
  clearFilters()
}

function toggleDetails(id: number) {
  expandedDetailsIds.value = expandedDetailsIds.value.includes(id)
    ? expandedDetailsIds.value.filter((entryId) => entryId !== id)
    : [...expandedDetailsIds.value, id]
}

function toggleText(id: number) {
  expandedTextIds.value = expandedTextIds.value.includes(id)
    ? expandedTextIds.value.filter((entryId) => entryId !== id)
    : [...expandedTextIds.value, id]
}

function isDetailsOpen(id: number) {
  return expandedDetailsIds.value.includes(id)
}

function isTextOpen(id: number) {
  return expandedTextIds.value.includes(id)
}

function hasLongText(entry: { action: string; description: string }) {
  return entry.action.length > 32 || entry.description.length > 100
}

onMounted(fetchPage)

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
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('audit.pageTitle') }}</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('audit.pageSubtitle') }}
    </p>
  </div>

  <div class="mt-5 md:mt-0 space-y-4">
    <div class="border border-border rounded-lg bg-card overflow-hidden shadow-xs">
      <button
        class="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        @click="filtersOpen = !filtersOpen"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground">{{ t('audit.filters') }}</p>
          <p v-if="activeFilterChips.length === 0" class="text-xs text-muted-foreground">{{ t('audit.noActiveFilters') }}</p>
          <div v-else class="mt-1 flex flex-wrap gap-1.5">
            <span
              v-for="chip in activeFilterChips"
              :key="chip"
              class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {{ chip }}
            </span>
          </div>
        </div>
        <ChevronUp v-if="filtersOpen" :size="15" class="text-muted-foreground shrink-0" />
        <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
      </button>

      <div v-if="filtersOpen" class="border-t border-border p-4">
        <div class="grid gap-3 md:flex md:flex-wrap md:items-end md:gap-2">
          <div class="flex flex-col gap-1 md:w-auto">
            <label class="text-xs text-muted-foreground">{{ t('audit.filterLabels.action') }}</label>
            <input
              v-model="filters.action"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring md:w-44"
              :placeholder="t('audit.filterPlaceholders.action')"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="flex flex-col gap-1 md:w-auto">
            <label class="text-xs text-muted-foreground">{{ t('audit.filterLabels.userId') }}</label>
            <input
              v-model="filters.userId"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring md:w-28"
              :placeholder="t('audit.filterPlaceholders.userId')"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="flex flex-col gap-1 md:w-auto">
            <label class="text-xs text-muted-foreground">{{ t('audit.filterLabels.from') }}</label>
            <input
              v-model="filters.dateFrom"
              type="date"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div class="flex flex-col gap-1 md:w-auto">
            <label class="text-xs text-muted-foreground">{{ t('audit.filterLabels.to') }}</label>
            <input
              v-model="filters.dateTo"
              type="date"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div class="hidden md:flex gap-2">
            <button class="settings-btn-primary h-8" @click="handleSearch">
              <Search :size="13" />
              {{ t('common.search') }}
            </button>
            <button v-if="hasFilters" class="settings-btn-outline h-8" @click="handleClear">
              <X :size="13" />
              {{ t('audit.clear') }}
            </button>
            <button class="settings-btn-outline h-8" :disabled="loading" @click="fetchPage">
              <RefreshCw :size="13" :class="loading ? 'animate-spin' : ''" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="md:hidden sticky top-0 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center gap-2">
        <button class="settings-btn-primary h-9 flex-1 justify-center" @click="handleSearch">
          <Search :size="13" />
          {{ t('common.search') }}
        </button>
        <button v-if="hasFilters" class="settings-btn-outline h-9" @click="handleClear">
          <X :size="13" />
          {{ t('audit.clear') }}
        </button>
        <button class="settings-btn-outline h-9 px-2.5" :disabled="loading" @click="fetchPage">
          <RefreshCw :size="13" :class="loading ? 'animate-spin' : ''" />
        </button>
      </div>
    </div>

    <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

    <div class="hidden md:block rounded-lg border border-border overflow-hidden shadow-xs">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">{{ t('audit.columns.when') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">{{ t('audit.columns.user') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">{{ t('audit.columns.action') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('audit.columns.description') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap hidden md:table-cell">{{ t('audit.columns.ip') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-if="loading">
            <td colspan="5" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t('audit.empty') }}</td>
          </tr>
          <tr
            v-else
            v-for="entry in entries"
            :key="entry.id"
            class="transition-colors"
            :class="isFailedAuth(entry.action) ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/30'"
          >
            <td class="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{{ formatDate(entry.createdAt) }}</td>
            <td class="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{{ entry.actorUsername }}</td>
            <td class="px-4 py-2.5 whitespace-nowrap">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-mono"
                :class="isFailedAuth(entry.action) ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'"
              >
                {{ entry.action }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-muted-foreground max-w-xs truncate">{{ entry.description }}</td>
            <td class="px-4 py-2.5 text-muted-foreground font-mono text-xs hidden md:table-cell">{{ entry.ip ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="md:hidden border border-border rounded-lg bg-card overflow-hidden divide-y divide-border shadow-xs">
      <div v-if="loading" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t('common.loading') }}</div>
      <div v-else-if="entries.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t('audit.empty') }}</div>
      <div v-else v-for="entry in entries" :key="entry.id" class="px-4 py-3" :class="isFailedAuth(entry.action) ? 'bg-destructive/5' : 'bg-card'">
        <div class="flex items-start justify-between gap-3">
          <p class="text-xs text-muted-foreground">{{ formatDate(entry.createdAt) }}</p>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-mono"
            :class="isFailedAuth(entry.action) ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'"
          >
            <span :class="isTextOpen(entry.id) ? '' : 'line-clamp-2'">{{ entry.action }}</span>
          </span>
        </div>
        <p class="mt-1 text-xs font-mono text-muted-foreground">@{{ entry.actorUsername }}</p>
        <p class="mt-2 text-sm text-muted-foreground" :class="isTextOpen(entry.id) ? '' : 'line-clamp-2'">{{ entry.description }}</p>
        <div class="mt-2 flex items-center gap-3">
          <button v-if="hasLongText(entry)" class="text-xs text-primary hover:underline" @click="toggleText(entry.id)">
            {{ isTextOpen(entry.id) ? t('audit.showLess') : t('audit.showMore') }}
          </button>
          <button class="text-xs text-muted-foreground hover:text-foreground" @click="toggleDetails(entry.id)">
            {{ isDetailsOpen(entry.id) ? t('audit.hideDetails') : t('audit.details') }}
          </button>
        </div>
        <div
          v-if="isDetailsOpen(entry.id)"
          class="mt-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground space-y-1"
        >
          <p class="font-mono">{{ t('audit.detailAction', { value: entry.action }) }}</p>
          <p class="font-mono">{{ t('audit.detailIp', { value: entry.ip ?? '-' }) }}</p>
        </div>
      </div>
    </div>

    <div v-if="totalPages > 1" class="hidden md:flex items-center justify-between text-sm text-muted-foreground">
      <span>{{ t('audit.showing', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total }) }}</span>
      <div class="flex items-center gap-1">
        <button
          class="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          <ChevronLeft :size="16" />
        </button>
        <span class="px-2">{{ page }} / {{ totalPages }}</span>
        <button
          class="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="page >= totalPages"
          @click="goToPage(page + 1)"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </div>

    <div v-if="totalPages > 1" class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <button
          class="rounded-md border border-border px-3 min-h-9 text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          {{ t('audit.prev') }}
        </button>
        <span class="text-xs text-muted-foreground text-center">
          {{ (page - 1) * pageSize + 1 }}-{{ Math.min(page * pageSize, total) }} / {{ total }}
        </span>
        <button
          class="rounded-md border border-border px-3 min-h-9 text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="page >= totalPages"
          @click="goToPage(page + 1)"
        >
          {{ t('common.next') }}
        </button>
      </div>
    </div>
  </div>
</template>
