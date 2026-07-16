<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, GripVertical } from '@lucide/vue'
import { Skeleton } from '@/components/ui/skeleton'
import ChartEmptyState from './ChartEmptyState.vue'

const props = defineProps<{
  title: string
  icon: Component
  colorIndex: number
  loading: boolean
  empty: boolean
  emptyTitle?: string
  emptyDescription?: string
  unknownCount?: number
  error?: boolean
}>()

const { t } = useI18n()

const ICON_HUE_OFFSETS = [0, 45, 90, 135, 180, 225, 270, 315, 337]

const iconStyle = computed(() => {
  const offset = ICON_HUE_OFFSETS[(props.colorIndex - 1) % ICON_HUE_OFFSETS.length] ?? 0
  const color = `oklch(from var(--primary) l c calc(h + ${offset}))`
  return { backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`, color }
})
</script>

<template>
  <div
    :class="[
      'bg-card text-card-foreground flex h-full min-h-[320px] flex-col overflow-hidden rounded-lg border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md md:min-h-0',
    ]"
  >
    <div class="flex min-h-0 flex-1 flex-col p-4">
      <div class="mb-3 flex items-center justify-between gap-2 border-b pb-3">
        <div class="flex items-center gap-2.5">
          <div class="shrink-0 rounded-md p-2" :style="iconStyle">
            <component :is="icon" class="size-4" />
          </div>
          <p class="text-foreground text-sm font-semibold">{{ title }}</p>
        </div>
        <div class="flex items-center gap-2">
          <slot name="controls" />
          <GripVertical class="drag-handle text-muted-foreground/70 hover:text-muted-foreground size-4 cursor-grab active:cursor-grabbing" />
        </div>
      </div>

      <div class="min-h-0 flex-1">
        <div v-if="loading" class="flex h-full flex-col gap-2">
          <Skeleton class="h-full w-full rounded-lg" />
        </div>

        <div v-else-if="error" class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
          <AlertCircle class="size-6" />
          <p class="text-sm">{{ t('statistics.card.loadError') }}</p>
        </div>

        <div v-else-if="empty" class="h-full">
          <ChartEmptyState
            :icon="icon"
            :title="emptyTitle ?? t('statistics.card.emptyTitle')"
            :description="emptyDescription ?? t('statistics.card.emptyDescription')"
          />
        </div>

        <slot v-else />
      </div>

      <p v-if="!loading && !error && unknownCount && unknownCount > 0" class="text-muted-foreground mt-2 text-xs">
        {{ t('statistics.card.unknownField', { count: unknownCount }, unknownCount) }}
      </p>
    </div>
  </div>
</template>
