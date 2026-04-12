<script setup lang="ts">
import { onMounted, computed, ref, watch } from 'vue'
import { RefreshCw, Search, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { AuditAction } from '@projectx/types'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { useAuditLog } from './useAuditLog'
import { useMediaQuery } from '@vueuse/core'

const { entries, total, page, pageSize, loading, error, filters, fetchPage, applyFilters, clearFilters, goToPage } = useAuditLog()

const totalPages = computed(() => Math.ceil(total.value / pageSize))
const hasFilters = computed(() => filters.action || filters.userId || filters.dateFrom || filters.dateTo)
const isMobile = useMediaQuery('(max-width: 767px)')
const filtersOpen = ref(true)
const expandedDetailsIds = ref<number[]>([])
const expandedTextIds = ref<number[]>([])

const activeFilterChips = computed(() => {
  const chips: string[] = []
  if (filters.action) chips.push(`Action: ${filters.action}`)
  if (filters.userId) chips.push(`User: ${filters.userId}`)
  if (filters.dateFrom) chips.push(`From: ${filters.dateFrom}`)
  if (filters.dateTo) chips.push(`To: ${filters.dateTo}`)
  return chips
})

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
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
  <SettingsPageHeader class="hidden md:flex" title="Audit Log" subtitle="A record of admin-significant actions performed across the system." />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Audit Log</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      A record of admin-significant actions performed across the system.
    </p>
  </div>

  <div class="mt-5 md:mt-0 space-y-4">
    <div class="border border-border rounded-lg bg-card overflow-hidden">
      <button
        class="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        @click="filtersOpen = !filtersOpen"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground">Filters</p>
          <p v-if="activeFilterChips.length === 0" class="text-xs text-muted-foreground">No active filters</p>
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
            <label class="text-xs text-muted-foreground">Action</label>
            <input
              v-model="filters.action"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring md:w-44"
              placeholder="e.g. auth.login"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="flex flex-col gap-1 md:w-auto">
            <label class="text-xs text-muted-foreground">User ID</label>
            <input
              v-model="filters.userId"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring md:w-28"
              placeholder="e.g. 1"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="flex flex-col gap-1 md:w-auto">
            <label class="text-xs text-muted-foreground">From</label>
            <input
              v-model="filters.dateFrom"
              type="date"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div class="flex flex-col gap-1 md:w-auto">
            <label class="text-xs text-muted-foreground">To</label>
            <input
              v-model="filters.dateTo"
              type="date"
              class="h-9 md:h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div class="hidden md:flex gap-2">
            <button class="settings-btn-primary h-8" @click="handleSearch">
              <Search :size="13" />
              Search
            </button>
            <button v-if="hasFilters" class="settings-btn-outline h-8" @click="handleClear">
              <X :size="13" />
              Clear
            </button>
            <button class="settings-btn-outline h-8" :disabled="loading" @click="fetchPage">
              <RefreshCw :size="13" :class="loading ? 'animate-spin' : ''" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="md:hidden sticky top-[5.25rem] z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center gap-2">
        <button class="settings-btn-primary h-9 flex-1 justify-center" @click="handleSearch">
          <Search :size="13" />
          Search
        </button>
        <button v-if="hasFilters" class="settings-btn-outline h-9" @click="handleClear">
          <X :size="13" />
          Clear
        </button>
        <button class="settings-btn-outline h-9 px-2.5" :disabled="loading" @click="fetchPage">
          <RefreshCw :size="13" :class="loading ? 'animate-spin' : ''" />
        </button>
      </div>
    </div>

    <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

    <div class="hidden md:block rounded-lg border border-border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">When</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">User</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Action</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap hidden md:table-cell">IP</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-if="loading">
            <td colspan="5" class="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-sm text-muted-foreground">No audit logs found</td>
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

    <div class="md:hidden border border-border rounded-lg bg-card overflow-hidden divide-y divide-border">
      <div v-if="loading" class="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</div>
      <div v-else-if="entries.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">No audit logs found</div>
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
            {{ isTextOpen(entry.id) ? 'Show less' : 'Show more' }}
          </button>
          <button class="text-xs text-muted-foreground hover:text-foreground" @click="toggleDetails(entry.id)">
            {{ isDetailsOpen(entry.id) ? 'Hide details' : 'Details' }}
          </button>
        </div>
        <div
          v-if="isDetailsOpen(entry.id)"
          class="mt-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground space-y-1"
        >
          <p class="font-mono">Action: {{ entry.action }}</p>
          <p class="font-mono">IP: {{ entry.ip ?? '-' }}</p>
        </div>
      </div>
    </div>

    <div v-if="totalPages > 1" class="hidden md:flex items-center justify-between text-sm text-muted-foreground">
      <span>Showing {{ (page - 1) * pageSize + 1 }}-{{ Math.min(page * pageSize, total) }} of {{ total }}</span>
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
          Prev
        </button>
        <span class="text-xs text-muted-foreground text-center">
          {{ (page - 1) * pageSize + 1 }}-{{ Math.min(page * pageSize, total) }} / {{ total }}
        </span>
        <button
          class="rounded-md border border-border px-3 min-h-9 text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="page >= totalPages"
          @click="goToPage(page + 1)"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
