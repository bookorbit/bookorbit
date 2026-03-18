<script setup lang="ts">
import type { Component } from 'vue'
import { AlertCircle, GripVertical } from 'lucide-vue-next'
import { Skeleton } from '@/components/ui/skeleton'

defineProps<{
  title: string
  icon: Component
  colorIndex: number
  loading: boolean
  empty: boolean
  unknownCount?: number
  error?: boolean
  tall?: boolean
  short?: boolean
}>()
</script>

<template>
  <div
    :class="[
      'bg-card text-card-foreground flex flex-col overflow-hidden rounded-xl border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
      tall ? 'h-[560px] md:h-[640px]' : short ? 'h-[240px] md:h-[280px]' : 'h-[320px] md:h-[360px]',
    ]"
  >
    <div class="flex min-h-0 flex-1 flex-col p-4">
      <div class="mb-3 flex items-center justify-between gap-2 border-b pb-3">
        <div class="flex items-center gap-2.5">
          <div
            class="shrink-0 rounded-md p-2"
            :style="{
              backgroundColor: `color-mix(in oklch, var(--chart-icon-${colorIndex}) 15%, transparent)`,
              color: `var(--chart-icon-${colorIndex})`,
            }"
          >
            <component :is="icon" class="size-4" />
          </div>
          <p class="text-foreground text-sm font-semibold">{{ title }}</p>
        </div>
        <div class="flex items-center gap-2">
          <slot name="controls" />
          <GripVertical class="drag-handle text-muted-foreground/50 hover:text-muted-foreground size-4 cursor-grab active:cursor-grabbing" />
        </div>
      </div>

      <div class="min-h-0 flex-1">
        <div v-if="loading" class="flex h-full flex-col gap-2">
          <Skeleton class="h-full w-full rounded-lg" />
        </div>

        <div v-else-if="error" class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
          <AlertCircle class="size-6" />
          <p class="text-sm">Failed to load data</p>
        </div>

        <div v-else-if="empty" class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
          <component :is="icon" class="size-9 opacity-20" />
          <div class="flex flex-col items-center gap-1">
            <p class="text-sm font-medium">No data yet</p>
            <p class="text-xs opacity-60">No data available for this chart</p>
          </div>
        </div>

        <slot v-else />
      </div>

      <p v-if="!loading && !error && unknownCount && unknownCount > 0" class="text-muted-foreground mt-2 text-xs">
        {{ unknownCount }} {{ unknownCount === 1 ? 'book has' : 'books have' }} no data for this field
      </p>
    </div>
  </div>
</template>
