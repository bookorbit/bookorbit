<script setup lang="ts">
import { computed } from 'vue'
import type { KoreaderReadingSession } from '@bookorbit/types'

const props = defineProps<{
  sessions: KoreaderReadingSession[]
  total: number
  page: number
  pageSize: number
  loading: boolean
}>()

const emit = defineEmits<{
  pageChange: [page: number]
}>()

const totalPages = computed(() => Math.ceil(props.total / props.pageSize))

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function handlePrev() {
  emit('pageChange', props.page - 1)
}

function handleNext() {
  emit('pageChange', props.page + 1)
}
</script>

<template>
  <div>
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-xs sm:text-sm">
        <thead>
          <tr class="border-b border-border bg-muted/50">
            <th class="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-4 sm:py-2.5 sm:text-xs">
              Date
            </th>
            <th class="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-4 sm:py-2.5 sm:text-xs">
              Page
            </th>
            <th class="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-4 sm:py-2.5 sm:text-xs">
              Duration
            </th>
            <th class="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-4 sm:py-2.5 sm:text-xs">
              Progress
            </th>
          </tr>
        </thead>
        <tbody :class="{ 'opacity-50': loading }">
          <template v-if="sessions.length === 0 && !loading">
            <tr>
              <td colspan="4" class="px-4 py-6 text-center text-muted-foreground text-sm">No sessions recorded yet</td>
            </tr>
          </template>
          <tr v-for="session in sessions" :key="session.id" class="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
            <td class="px-3 py-2 text-foreground sm:px-4 sm:py-2.5">{{ formatDate(session.startedAt) }}</td>
            <td class="px-3 py-2 text-right tabular-nums text-foreground sm:px-4 sm:py-2.5">{{ session.page }}</td>
            <td class="px-3 py-2 text-right tabular-nums text-foreground sm:px-4 sm:py-2.5">{{ formatDuration(session.durationSeconds) }}</td>
            <td class="px-3 py-2 text-right text-[11px] tabular-nums text-muted-foreground sm:px-4 sm:py-2.5 sm:text-xs">
              {{ Math.round((session.page / session.totalPages) * 100) }}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="totalPages > 1" class="mt-3 flex items-center justify-between text-xs sm:text-sm">
      <span class="text-muted-foreground">{{ total }} sessions total</span>
      <div class="flex items-center gap-1.5 sm:gap-2">
        <button
          class="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 sm:px-3 sm:py-1.5 sm:text-sm"
          :disabled="page <= 1"
          @click="handlePrev"
        >
          Previous
        </button>
        <span class="text-muted-foreground">{{ page }} / {{ totalPages }}</span>
        <button
          class="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 sm:px-3 sm:py-1.5 sm:text-sm"
          :disabled="page >= totalPages"
          @click="handleNext"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
