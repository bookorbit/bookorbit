<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronDown, GripVertical, Settings2 } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'

import type { ChartConfigEntry, StatisticsChartId } from '@projectx/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { STATISTICS_CHART_META } from '../statistics-chart-meta'
import { useStatisticsConfig } from '../composables/useStatisticsConfig'
import StatisticsGrid from './StatisticsGrid.vue'
import StatisticsSummaryCard from './StatisticsSummaryCard.vue'

const {
  orderedLibraryCharts,
  orderedUserCharts,
  visibleLibraryCharts,
  visibleUserCharts,
  libraryChartCount,
  userChartCount,
  visibleLibraryChartCount,
  visibleUserChartCount,
  filters,
  init,
  toggleVisibility,
  reorder,
  resetToDefaults,
  setLibraryFilter,
} = useStatisticsConfig()

const route = useRoute()
const router = useRouter()
const { libraries, fetchLibraries } = useLibraries()
const configOpen = ref(false)

const initialTab = route.query.tab === 'user' ? 'user' : 'library'
const activeTab = ref<'library' | 'user'>(initialTab)
const loaded = ref<Set<'library' | 'user'>>(new Set([initialTab]))

// Called in setup (not onMounted) so filters are populated before chart children mount.
init()
onMounted(fetchLibraries)

const activeVisibleCount = computed(() => (activeTab.value === 'library' ? visibleLibraryChartCount.value : visibleUserChartCount.value))
const activeTotalCount = computed(() => (activeTab.value === 'library' ? libraryChartCount.value : userChartCount.value))
const activeOrderedCharts = computed(() => (activeTab.value === 'library' ? orderedLibraryCharts.value : orderedUserCharts.value))

const libraryLabel = computed(() => {
  const count = filters.value.libraryIds.length
  if (count === 0 || count === libraries.value.length) return 'All Libraries'
  return `${count} of ${libraries.value.length} Libraries`
})

const isFiltered = computed(() => filters.value.libraryIds.length > 0 && filters.value.libraryIds.length < libraries.value.length)

function isLibrarySelected(id: number) {
  return filters.value.libraryIds.length === 0 || filters.value.libraryIds.includes(id)
}

function handleToggleLibrary(id: number) {
  const current = filters.value.libraryIds
  if (current.length === 0) {
    setLibraryFilter(libraries.value.map((l) => l.id).filter((lid) => lid !== id))
  } else if (current.includes(id)) {
    const next = current.filter((lid) => lid !== id)
    setLibraryFilter(next.length === 0 ? [] : next)
  } else {
    const next = [...current, id]
    setLibraryFilter(next.length === libraries.value.length ? [] : next)
  }
}

function handleSelectAll() {
  setLibraryFilter([])
}

function handleToggleChart(id: StatisticsChartId) {
  toggleVisibility(id)
}

function handleReorder(newList: ChartConfigEntry[]) {
  reorder(newList)
}

function handleReset() {
  resetToDefaults()
}

function openConfig() {
  configOpen.value = true
}

function chartMeta(id: StatisticsChartId) {
  return STATISTICS_CHART_META[id]
}

function setTab(tab: 'library' | 'user') {
  activeTab.value = tab
  loaded.value.add(tab)
  void router.replace({ query: { ...route.query, tab } })
}
</script>

<template>
  <div class="flex flex-col gap-6 pt-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1 rounded-lg bg-muted p-1">
        <button
          :class="[
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'library' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          ]"
          @click="setTab('library')"
        >
          Library Stats
        </button>
        <button
          :class="[
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'user' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          ]"
          @click="setTab('user')"
        >
          My Reading
        </button>
      </div>

      <div class="flex items-center gap-2">
        <Popover v-if="activeTab === 'library' && libraries.length > 1">
          <PopoverTrigger as-child>
            <button
              :class="[
                'flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors',
                isFiltered ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15' : 'border-border text-foreground hover:bg-accent',
              ]"
            >
              {{ libraryLabel }}
              <ChevronDown class="size-3.5 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-56 p-1.5">
            <button
              class="text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
              @click="handleSelectAll"
            >
              <div :class="['flex size-4 items-center justify-center rounded border', !isFiltered ? 'border-primary bg-primary' : 'border-border']">
                <Check v-if="!isFiltered" class="text-primary-foreground size-2.5" />
              </div>
              All Libraries
            </button>
            <div class="border-border my-1 border-t" />
            <button
              v-for="lib in libraries"
              :key="lib.id"
              class="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
              @click="handleToggleLibrary(lib.id)"
            >
              <div
                :class="[
                  'flex size-4 shrink-0 items-center justify-center rounded border',
                  isLibrarySelected(lib.id) ? 'border-primary bg-primary' : 'border-border',
                ]"
              >
                <Check v-if="isLibrarySelected(lib.id)" class="text-primary-foreground size-2.5" />
              </div>
              <span class="truncate">{{ lib.name }}</span>
            </button>
          </PopoverContent>
        </Popover>

        <button
          class="bg-muted text-foreground hover:bg-muted/70 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors"
          @click="openConfig"
        >
          <Settings2 class="size-3.5" />
          Configure
        </button>
      </div>
    </div>

    <StatisticsSummaryCard />

    <Sheet v-model:open="configOpen">
      <SheetContent side="right" class="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <div class="flex items-center justify-between pr-8">
            <SheetTitle>Configure Charts</SheetTitle>
            <span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
              {{ activeVisibleCount }} / {{ activeTotalCount }}
            </span>
          </div>
          <SheetDescription>Drag to reorder, toggle to show or hide.</SheetDescription>
        </SheetHeader>

        <div class="flex-1 overflow-y-auto px-4">
          <VueDraggable
            :model-value="activeOrderedCharts"
            class="flex flex-col gap-2"
            handle=".drawer-drag-handle"
            :animation="150"
            @update:model-value="handleReorder"
          >
            <div
              v-for="chart in activeOrderedCharts"
              :key="chart.id"
              :class="[
                'border-border/50 bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-opacity',
                !chart.visible && 'opacity-50',
              ]"
            >
              <GripVertical class="text-muted-foreground/80 drawer-drag-handle size-4 shrink-0 cursor-grab active:cursor-grabbing" />
              <component :is="chartMeta(chart.id).icon" :class="['size-4 shrink-0', chart.visible ? 'text-primary' : 'text-muted-foreground']" />
              <span :class="['flex-1 text-sm', chart.visible ? 'text-foreground' : 'text-muted-foreground']">
                {{ chartMeta(chart.id).label }}
              </span>
              <ToggleSwitch :model-value="chart.visible" @update:model-value="handleToggleChart(chart.id)" />
            </div>
          </VueDraggable>
        </div>

        <SheetFooter>
          <button
            class="text-muted-foreground hover:text-foreground w-full rounded-md py-2 text-sm transition-colors hover:bg-transparent"
            @click="handleReset"
          >
            Reset to defaults
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <div v-if="loaded.has('library')" v-show="activeTab === 'library'">
      <StatisticsGrid :charts="visibleLibraryCharts" />
    </div>
    <div v-if="loaded.has('user')" v-show="activeTab === 'user'">
      <StatisticsGrid :charts="visibleUserCharts" />
    </div>
  </div>
</template>
