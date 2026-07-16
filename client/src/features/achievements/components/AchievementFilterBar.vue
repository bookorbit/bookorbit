<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Medal, Trophy } from '@lucide/vue'
import type { FilterState } from '../types'

const { t } = useI18n()

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
  return props.activeFilter === filter
    ? 'bg-primary/15 text-foreground shadow-sm ring-1 ring-primary/20'
    : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
}
</script>

<template>
  <div class="relative overflow-hidden rounded-lg border border-border/60 bg-muted/35 p-2">
    <Medal class="pointer-events-none absolute right-0 top-0 text-muted-foreground opacity-[0.05]" :size="72" aria-hidden="true" />

    <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="flex min-w-0 shrink-0 items-center gap-3">
        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-background/60">
          <Trophy class="size-6 text-primary" />
        </div>
        <div class="min-w-0">
          <h1 class="text-base font-semibold tracking-tight text-foreground/90 sm:text-md">{{ t('achievements.title') }}</h1>
          <span class="text-muted-foreground text-sm tabular-nums">{{
            t('achievements.tiersCount', { earned: totalEarned, total: totalAvailable })
          }}</span>
        </div>
      </div>

      <div class="bg-border h-px w-full sm:h-8 sm:w-px" />

      <div class="-mx-1 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:px-0 sm:pb-0">
        <div class="inline-flex min-w-max items-center gap-1 rounded-md border border-border/50 bg-background/70 p-1">
          <button :class="['shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', pillClass('all')]" @click="handleAll">
            {{ t('achievements.filter.all') }}
          </button>
          <button :class="['shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', pillClass('earned')]" @click="handleEarned">
            {{ t('achievements.filter.earned', { count: earnedCount }) }}
          </button>
          <button
            :class="['shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', pillClass('in-progress')]"
            @click="handleInProgress"
          >
            {{ t('achievements.filter.inProgress', { count: inProgressCount }) }}
          </button>
          <button :class="['shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', pillClass('locked')]" @click="handleLocked">
            {{ t('achievements.filter.locked', { count: lockedCount }) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
