<script setup lang="ts">
import { Flame, Trophy } from 'lucide-vue-next'

import { useReadingStreakWidget } from '../../composables/useReadingStreakWidget'

const { data, loading, error } = useReadingStreakWidget()
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <Flame :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">Reading Streak</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-12 w-12 animate-pulse rounded-full bg-muted" />
      <div class="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">Failed to load</div>

    <!-- Empty (no reading at all) -->
    <div v-else-if="!data || (data.currentStreak === 0 && data.longestStreak === 0)" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Flame :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">Read today to start your streak</p>
    </div>

    <!-- Streak data -->
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2.5">
      <!-- Current streak -->
      <div class="flex flex-col items-center mb-1">
        <div class="flex items-baseline gap-1">
          <Flame :size="20" class="text-orange-500" />
          <span class="text-3xl font-bold tabular-nums">{{ data.currentStreak }}</span>
        </div>
        <span class="text-xs text-muted-foreground">{{ data.currentStreak === 1 ? 'day' : 'days' }} streak</span>
      </div>

      <!-- Best streak -->
      <div class="flex items-center gap-1 text-xs text-muted-foreground">
        <Trophy :size="12" />
        <span>Best: {{ data.longestStreak }} {{ data.longestStreak === 1 ? 'day' : 'days' }}</span>
      </div>

      <!-- Last 7 days dots -->
      <div class="flex items-center gap-1.5">
        <div
          v-for="(active, i) in data.lastSevenDays"
          :key="i"
          class="h-3 w-3 rounded-full transition-colors"
          :class="active ? 'bg-primary' : 'bg-muted'"
        />
      </div>
      <p class="text-[11px] text-muted-foreground">Last 7 days</p>
    </div>
  </div>
</template>
