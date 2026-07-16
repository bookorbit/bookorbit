<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookCopy, HardDrive, Library, Users } from '@lucide/vue'
import { useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'

import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryOverviewWidget } from '../../composables/useLibraryOverviewWidget'

const { data, loading, error } = useLibraryOverviewWidget()
const { t } = useI18n()
const router = useRouter()
const { libraries } = useLibraries()

function formatStorage(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

type StatRoute = RouteLocationRaw | null

interface Stat {
  label: string
  value: string | number
  icon: Component
  route: StatRoute
}

const stats = computed<Stat[]>(() => {
  if (!data.value) return []
  const firstLibraryId = libraries.value[0]?.id ?? null
  return [
    {
      label: t('dashboard.widgets.libraryOverview.stats.books'),
      value: data.value.totalBooks,
      icon: Library,
      route: firstLibraryId ? { name: 'library', params: { id: firstLibraryId } } : null,
    },
    { label: t('dashboard.widgets.libraryOverview.stats.authors'), value: data.value.totalAuthors, icon: Users, route: { name: 'authors' } },
    { label: t('dashboard.widgets.libraryOverview.stats.series'), value: data.value.totalSeries, icon: BookCopy, route: { name: 'series' } },
    { label: t('dashboard.widgets.libraryOverview.stats.storage'), value: formatStorage(data.value.totalStorageBytes), icon: HardDrive, route: null },
  ]
})

function navigate(route: StatRoute) {
  if (route) void router.push(route)
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-2 flex items-center gap-2 self-start">
      <Library :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.libraryOverview.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="grid flex-1 grid-cols-2 gap-2">
      <div v-for="n in 4" :key="n" class="flex flex-col items-center justify-center rounded-lg bg-muted/40 p-2">
        <div class="h-5 w-10 animate-pulse rounded bg-muted" />
        <div class="mt-1 h-2.5 w-8 animate-pulse rounded bg-muted" />
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Empty -->
    <div v-else-if="!data || data.totalBooks === 0" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Library :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.libraryOverview.empty') }}</p>
    </div>

    <!-- Stats grid -->
    <div v-else class="flex min-h-0 flex-1 flex-col gap-2 p-1">
      <div class="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="flex min-h-0 min-w-0 items-center justify-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2 py-1.5 transition-colors"
          :class="stat.route ? 'cursor-pointer hover:bg-muted/60 hover:border-border' : ''"
          @click="navigate(stat.route)"
        >
          <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <component :is="stat.icon" :size="14" />
          </div>
          <div class="min-w-0 text-left">
            <span class="block max-w-full truncate text-[15px] font-bold tabular-nums leading-tight">{{ stat.value }}</span>
            <span class="block text-[11px] leading-tight text-muted-foreground">{{ stat.label }}</span>
          </div>
        </div>
      </div>

      <!-- Added this year callout -->
      <div v-if="data.booksAddedThisYear > 0" class="shrink-0 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-center">
        <span class="text-[11px] font-medium leading-none text-primary">{{
          t('dashboard.widgets.libraryOverview.addedThisYear', { count: data.booksAddedThisYear })
        }}</span>
      </div>
    </div>
  </div>
</template>
