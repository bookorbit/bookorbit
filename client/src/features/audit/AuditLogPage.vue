<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { RefreshCw, Search, X, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { AuditAction } from '@projectx/types'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { useAuditLog } from './useAuditLog'

const { entries, total, page, pageSize, loading, error, filters, fetchPage, applyFilters, clearFilters, goToPage } = useAuditLog()

const totalPages = computed(() => Math.ceil(total.value / pageSize))
const hasFilters = computed(() => filters.action || filters.userId || filters.dateFrom || filters.dateTo)

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

onMounted(fetchPage)
</script>

<template>
  <SettingsPageHeader title="Audit Log" subtitle="A record of admin-significant actions performed across the system." />

  <div class="space-y-4">
    <div class="flex flex-wrap gap-2 items-end">
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">Action</label>
        <input
          v-model="filters.action"
          class="h-8 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-44"
          placeholder="e.g. auth.login"
          @keydown.enter="handleSearch"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">User ID</label>
        <input
          v-model="filters.userId"
          class="h-8 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-28"
          placeholder="e.g. 1"
          @keydown.enter="handleSearch"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">From</label>
        <input
          v-model="filters.dateFrom"
          type="date"
          class="h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">To</label>
        <input
          v-model="filters.dateTo"
          type="date"
          class="h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div class="flex gap-2">
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

    <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

    <div class="rounded-lg border border-border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">When</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">User</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Action</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap hidden md:table-cell">IP</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap hidden md:table-cell">Country</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-if="loading">
            <td colspan="6" class="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-sm text-muted-foreground">No audit logs found</td>
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
            <td class="px-4 py-2.5 text-muted-foreground text-xs hidden md:table-cell">{{ entry.countryCode ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalPages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
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
  </div>
</template>
