<script setup lang="ts">
import type { FilterState } from '../types'

const props = defineProps<{
  activeFilter: FilterState
  totalEarned: number
  totalAvailable: number
  earnedCount: number
  inProgressCount: number
  lockedCount: number
}>()

const emit = defineEmits<{
  change: [filter: FilterState]
}>()

function handleAll(): void {
  emit('change', 'all')
}

function handleEarned(): void {
  emit('change', 'earned')
}

function handleInProgress(): void {
  emit('change', 'in-progress')
}

function handleLocked(): void {
  emit('change', 'locked')
}

function pillClass(filter: FilterState): string {
  return props.activeFilter === filter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
}
</script>

<template>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
    <div class="flex items-baseline gap-1 whitespace-nowrap">
      <span class="text-foreground text-xl font-bold tabular-nums leading-none">{{ totalEarned }}</span>
      <span class="text-muted-foreground text-sm">/ {{ totalAvailable }} earned</span>
    </div>
    <div class="bg-border hidden h-4 w-px shrink-0 sm:block" />
    <div class="-mx-1 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
      <div class="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap">
        <button :class="['shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors', pillClass('all')]" @click="handleAll">All</button>
        <button :class="['shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors', pillClass('earned')]" @click="handleEarned">
          Earned ({{ earnedCount }})
        </button>
        <button
          :class="['shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors', pillClass('in-progress')]"
          @click="handleInProgress"
        >
          In Progress ({{ inProgressCount }})
        </button>
        <button :class="['shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors', pillClass('locked')]" @click="handleLocked">
          Locked ({{ lockedCount }})
        </button>
      </div>
    </div>
  </div>
</template>
