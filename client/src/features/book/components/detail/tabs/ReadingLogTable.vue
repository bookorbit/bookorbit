<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, ChevronsUpDown, Trash2, X } from 'lucide-vue-next'
import type { BookReadingSession } from '@bookorbit/types'

const props = defineProps<{
  sessions: BookReadingSession[]
  total: number
  page: number
  pageSize: number
  sortBy: string
  sortDir: 'asc' | 'desc'
  loading: boolean
  hasMultipleFormats: boolean
}>()

const emit = defineEmits<{
  sortChange: [sortBy: string, sortDir: 'asc' | 'desc']
  pageChange: [page: number]
  deleteSession: [sessionId: number]
}>()

const confirmDeleteId = ref<number | null>(null)

watch(
  () => props.sessions,
  () => {
    confirmDeleteId.value = null
  },
)

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateCompact(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function handleDeleteClick(sessionId: number) {
  if (confirmDeleteId.value === sessionId) {
    emit('deleteSession', sessionId)
    confirmDeleteId.value = null
  } else {
    confirmDeleteId.value = sessionId
  }
}

function clearConfirmDelete() {
  confirmDeleteId.value = null
}

function handlePrevPage() {
  confirmDeleteId.value = null
  emit('pageChange', props.page - 1)
}

function handleNextPage() {
  confirmDeleteId.value = null
  emit('pageChange', props.page + 1)
}

function handleSort(col: string) {
  confirmDeleteId.value = null
  const dir = props.sortBy === col && props.sortDir === 'asc' ? 'desc' : 'asc'
  emit('sortChange', col, dir)
}

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const startItem = computed(() => Math.min((props.page - 1) * props.pageSize + 1, props.total))
const endItem = computed(() => Math.min(props.page * props.pageSize, props.total))

const SORTABLE_COLS = [
  { id: 'startedAt', label: 'Date', mobileLabel: 'Date' },
  { id: 'durationSeconds', label: 'Duration', mobileLabel: 'Duration' },
  { id: 'progressDelta', label: 'Progress Change', mobileLabel: 'Delta' },
  { id: 'endProgress', label: 'End Progress', mobileLabel: 'End' },
] as const
</script>

<template>
  <div @click.self="clearConfirmDelete">
    <div v-if="sessions.length === 0 && !loading" class="flex items-center justify-center py-10 text-muted-foreground text-sm">
      No reading sessions recorded yet.
    </div>

    <div v-else class="overflow-x-auto rounded-lg border border-border transition-opacity" :class="{ 'opacity-50 pointer-events-none': loading }">
      <table class="w-full min-w-max text-xs sm:text-sm">
        <thead>
          <tr class="border-b border-border bg-muted/50">
            <th
              v-for="col in SORTABLE_COLS"
              :key="col.id"
              class="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-3 sm:py-2.5 sm:text-xs"
            >
              <button class="flex items-center gap-1 whitespace-nowrap hover:text-foreground transition-colors" @click="() => handleSort(col.id)">
                <span class="sm:hidden">{{ col.mobileLabel }}</span>
                <span class="hidden sm:inline">{{ col.label }}</span>
                <ChevronUp v-if="sortBy === col.id && sortDir === 'asc'" :size="12" />
                <ChevronDown v-else-if="sortBy === col.id && sortDir === 'desc'" :size="12" />
                <ChevronsUpDown v-else :size="12" class="opacity-40" />
              </button>
            </th>
            <th
              v-if="hasMultipleFormats"
              class="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-3 sm:py-2.5 sm:text-xs"
            >
              <span class="sm:hidden">Fmt</span>
              <span class="hidden sm:inline">Format</span>
            </th>
            <th class="w-24 px-2 py-2 sm:px-3 sm:py-2.5" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="session in sessions"
            :key="session.id"
            class="border-b border-border odd:bg-muted/20 last:border-0 hover:bg-muted/30 transition-colors"
          >
            <td class="px-2 py-2 text-foreground whitespace-nowrap sm:px-3 sm:py-2.5">
              <span class="sm:hidden">{{ formatDateCompact(session.startedAt) }}</span>
              <span class="hidden sm:inline">{{ formatDate(session.startedAt) }}</span>
            </td>
            <td class="px-2 py-2 text-foreground whitespace-nowrap sm:px-3 sm:py-2.5">{{ formatDuration(session.durationSeconds) }}</td>
            <td
              class="px-2 py-2 whitespace-nowrap sm:px-3 sm:py-2.5"
              :class="session.progressDelta != null && session.progressDelta > 0 ? 'text-green-600' : 'text-muted-foreground'"
            >
              {{ session.progressDelta != null ? `+${session.progressDelta.toFixed(1)}%` : '-' }}
            </td>
            <td class="px-2 py-2 text-foreground whitespace-nowrap sm:px-3 sm:py-2.5">
              {{ session.endProgress != null ? `${session.endProgress.toFixed(1)}%` : '-' }}
            </td>
            <td v-if="hasMultipleFormats" class="px-2 py-2 text-foreground whitespace-nowrap sm:px-3 sm:py-2.5">{{ session.format ?? '-' }}</td>
            <td class="w-24 px-2 py-2 sm:px-3 sm:py-2.5">
              <div class="ml-auto flex h-6 w-[5.25rem] items-center justify-end gap-1">
                <template v-if="confirmDeleteId === session.id">
                  <button
                    class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Cancel delete"
                    aria-label="Cancel delete session"
                    @click="clearConfirmDelete"
                  >
                    <X :size="12" />
                  </button>
                  <button
                    class="inline-flex h-6 items-center justify-center rounded px-2 text-[10px] font-medium uppercase tracking-wide transition-colors bg-destructive/15 text-destructive ring-1 ring-destructive/40"
                    title="Click again to confirm delete"
                    aria-label="Confirm delete session"
                    @click="() => handleDeleteClick(session.id)"
                  >
                    Confirm
                  </button>
                </template>
                <button
                  v-else
                  class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  title="Delete"
                  aria-label="Delete session"
                  @click="() => handleDeleteClick(session.id)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > 0" class="mt-3 flex items-center justify-between text-xs text-muted-foreground sm:text-sm">
      <span>Showing {{ startItem }}-{{ endItem }} of {{ total }} sessions</span>
      <div class="flex items-center gap-1.5 sm:gap-2">
        <button
          class="rounded border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:py-1.5 sm:text-sm"
          :disabled="page <= 1"
          @click="handlePrevPage"
        >
          Prev
        </button>
        <span class="text-xs">{{ page }} / {{ totalPages }}</span>
        <button
          class="rounded border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:py-1.5 sm:text-sm"
          :disabled="page >= totalPages"
          @click="handleNextPage"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
