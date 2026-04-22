<script setup lang="ts">
import { ref, watch, type Component, type ComponentPublicInstance } from 'vue'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'

import type { WidgetConfig, WidgetType } from '@bookorbit/types'
import { useDashboardWidgets } from '../composables/useDashboardWidgets'
import ReadingGoalWidget from './widgets/ReadingGoalWidget.vue'
import CurrentlyReadingWidget from './widgets/CurrentlyReadingWidget.vue'
import ReadingStreakWidget from './widgets/ReadingStreakWidget.vue'
import LibraryOverviewWidget from './widgets/LibraryOverviewWidget.vue'
import HighlightOfTheDayWidget from './widgets/HighlightOfTheDayWidget.vue'
import MonthlyChallengeWidget from './widgets/MonthlyChallengeWidget.vue'
import YearProjectionWidget from './widgets/YearProjectionWidget.vue'
import NeglectedGemsWidget from './widgets/NeglectedGemsWidget.vue'
import ReadingDnaWidget from './widgets/ReadingDnaWidget.vue'
import LongWaitWidget from './widgets/LongWaitWidget.vue'
import DiversityScoreWidget from './widgets/DiversityScoreWidget.vue'
import ReadingRhythmWidget from './widgets/ReadingRhythmWidget.vue'

const { widgets, enabledWidgets, saveWidgets } = useDashboardWidgets()

// Local copy for optimistic drag updates — prevents flash on drop caused by
// the async me() refresh briefly reverting the computed enabledWidgets.
const localWidgets = ref<WidgetConfig[]>([...enabledWidgets.value])
watch(enabledWidgets, (val) => {
  localWidgets.value = [...val]
})

const scrollEl = ref<ComponentPublicInstance | null>(null)

function scrollBy(delta: number) {
  scrollEl.value?.$el?.scrollBy({ left: delta, behavior: 'smooth' })
}

function handleReorder(newEnabled: WidgetConfig[]) {
  localWidgets.value = newEnabled
  const disabledWidgets = widgets.value.filter((w) => !w.enabled)
  const reordered = newEnabled.map((w, i) => ({ ...w, order: i + 1 }))
  const disabledReordered = disabledWidgets.map((w, i) => ({ ...w, order: newEnabled.length + i + 1 }))
  saveWidgets([...reordered, ...disabledReordered])
}

const widgetComponents: Record<WidgetType, Component> = {
  'reading-goal': ReadingGoalWidget,
  'currently-reading': CurrentlyReadingWidget,
  'reading-streak': ReadingStreakWidget,
  'library-overview': LibraryOverviewWidget,
  'highlight-of-the-day': HighlightOfTheDayWidget,
  'monthly-challenge': MonthlyChallengeWidget,
  'year-projection': YearProjectionWidget,
  'neglected-gems': NeglectedGemsWidget,
  'reading-dna': ReadingDnaWidget,
  'long-wait': LongWaitWidget,
  'diversity-score': DiversityScoreWidget,
  'reading-rhythm': ReadingRhythmWidget,
}

type DashboardWidgetSize = '1x1' | '1x1.5'

const widgetLayout: Record<WidgetType, { size: DashboardWidgetSize }> = {
  'reading-goal': { size: '1x1' },
  'currently-reading': { size: '1x1.5' },
  'reading-streak': { size: '1x1' },
  'library-overview': { size: '1x1.5' },
  'highlight-of-the-day': { size: '1x1.5' },
  'monthly-challenge': { size: '1x1' },
  'year-projection': { size: '1x1' },
  'neglected-gems': { size: '1x1' },
  'reading-dna': { size: '1x1.5' },
  'long-wait': { size: '1x1' },
  'diversity-score': { size: '1x1' },
  'reading-rhythm': { size: '1x1.5' },
}

const widgetSizeClass: Record<DashboardWidgetSize, string> = {
  '1x1': 'w-[220px]',
  '1x1.5': 'w-[336px]',
}
</script>

<template>
  <section v-if="enabledWidgets.length > 0" class="group/widgets">
    <!-- Header -->
    <div class="mb-1 flex items-center justify-between px-1 pt-1">
      <h2 class="text-[18px] font-bold tracking-tight"></h2>
      <div class="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/widgets:opacity-100">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="scrollBy(-300)"
        >
          <ChevronLeft :size="16" />
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="scrollBy(300)"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </div>

    <!-- Widgets row -->
    <VueDraggable
      ref="scrollEl"
      :model-value="localWidgets"
      class="flex gap-4 overflow-x-auto px-1 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      handle=".widget-drag-handle"
      :animation="200"
      @update:model-value="handleReorder"
    >
      <div
        v-for="(widget, index) in localWidgets"
        :key="widget.id"
        class="group/card relative h-55 shrink-0 overflow-hidden rounded-2xl border border-primary/40 bg-card/30 shadow-sm backdrop-blur-[1px]"
        :class="widgetSizeClass[widgetLayout[widget.type].size]"
        style="animation: dashboardWidgetFadeUp 0.35s ease both"
        :style="{ animationDelay: `${index * 80}ms` }"
      >
        <component :is="widgetComponents[widget.type]" :size="widgetLayout[widget.type].size" />
        <!-- Drag handle — visible on card hover -->
        <div
          class="widget-drag-handle absolute right-2 top-2 flex h-6 w-6 cursor-grab items-center justify-center rounded-md text-muted-foreground/0 transition-all duration-150 hover:bg-background/80 hover:text-muted-foreground group-hover/card:text-muted-foreground/60 active:cursor-grabbing"
        >
          <GripVertical :size="14" />
        </div>
      </div>
    </VueDraggable>
  </section>
</template>

<style scoped>
@keyframes dashboardWidgetFadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
