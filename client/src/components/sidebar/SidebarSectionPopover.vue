<script setup lang="ts">
import type { Component } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatCompactNumber } from '@/i18n/formatters'

defineProps<{
  label: string
  icon: Component
  count: number
}>()
</script>

<template>
  <Popover>
    <PopoverTrigger
      class="relative flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      :aria-label="label"
      :title="label"
    >
      <component :is="icon" :size="17" aria-hidden="true" />
      <span
        v-if="count > 0"
        aria-hidden="true"
        class="absolute -bottom-0.5 -right-0.5 rounded-md bg-(--shell-accent-tint) px-1 text-[11px] font-semibold leading-tight tabular-nums text-sidebar-count-foreground"
      >
        {{ formatCompactNumber(count) }}
      </span>
    </PopoverTrigger>
    <PopoverContent side="right" align="start" :side-offset="8" class="w-72 border-(--shell-border) bg-(--shell-surface) p-1 backdrop-blur-xl">
      <slot />
    </PopoverContent>
  </Popover>
</template>
