<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from '@lucide/vue'
import { Permission, type ReadingAttempt, type ReadingAttemptListResponse, type ReadingAttemptOutcome, type UserBookStatus } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const props = defineProps<{ bookId: number }>()
const emit = defineEmits<{ saved: [readStatus: UserBookStatus] }>()
const { hasPermission } = usePermissions()
const canManageDestructive = computed(() => hasPermission(Permission.LibraryEditMetadata))

const attempts = ref<ReadingAttempt[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const page = ref(1)
const total = ref(0)
const pageSize = 10

const addOpen = ref(false)
const startOpen = ref(false)
const saving = ref(false)
const resetProgress = ref(true)
const startedOn = ref('')
const endedOn = ref('')
const outcome = ref<ReadingAttemptOutcome>('completed')
const editingId = ref<number | null>(null)

const hasPrevious = computed(() => page.value > 1)
const hasNext = computed(() => page.value * pageSize < total.value)

function formatDate(value: string | null) {
  if (!value) return 'Unknown'
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString()
}

function outcomeLabel(value: ReadingAttemptOutcome | null) {
  if (!value) return 'In progress'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await api(`/api/v1/books/${props.bookId}/reading-attempts?page=${page.value}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error('Failed to load reading history')
    const data = (await res.json()) as ReadingAttemptListResponse
    attempts.value = data.items
    total.value = data.total
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Failed to load reading history'
  } finally {
    loading.value = false
  }
}

function resetDraft() {
  startedOn.value = ''
  endedOn.value = ''
  outcome.value = 'completed'
  editingId.value = null
}

function handleToggleAdd() {
  resetDraft()
  addOpen.value = !addOpen.value
  startOpen.value = false
}

function handleToggleStart() {
  startOpen.value = !startOpen.value
  addOpen.value = false
}

function handleCancelEdit() {
  resetDraft()
}

function handleEdit(attempt: ReadingAttempt) {
  editingId.value = attempt.id
  startedOn.value = attempt.startedOn ?? ''
  endedOn.value = attempt.endedOn ?? ''
  outcome.value = attempt.outcome ?? 'completed'
}

async function handleSaveAttempt() {
  if (saving.value) return
  if (startedOn.value && endedOn.value && endedOn.value < startedOn.value) {
    error.value = 'End date must be on or after start date.'
    return
  }
  saving.value = true
  error.value = null
  try {
    const path = editingId.value
      ? `/api/v1/books/${props.bookId}/reading-attempts/${editingId.value}`
      : `/api/v1/books/${props.bookId}/reading-attempts`
    const res = await api(path, {
      method: editingId.value ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startedOn: startedOn.value || null, endedOn: endedOn.value || null, outcome: outcome.value }),
    })
    if (!res.ok) throw new Error('Failed to save reading attempt')
    addOpen.value = false
    resetDraft()
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Failed to save reading attempt'
  } finally {
    saving.value = false
  }
}

async function handleStartReread() {
  if (saving.value) return
  saving.value = true
  error.value = null
  try {
    const res = await api(`/api/v1/books/${props.bookId}/reading-attempts/start-reread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetProgress: resetProgress.value }),
    })
    if (!res.ok) throw new Error('Failed to start reread')
    const readStatus = (await res.json()) as UserBookStatus
    startOpen.value = false
    emit('saved', readStatus)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Failed to start reread'
  } finally {
    saving.value = false
  }
}

async function handleDelete(attempt: ReadingAttempt) {
  if (!window.confirm('Delete this reading attempt? External records will not be deleted.')) return
  const res = await api(`/api/v1/books/${props.bookId}/reading-attempts/${attempt.id}`, { method: 'DELETE' })
  if (!res.ok) {
    error.value = 'Failed to delete reading attempt'
    return
  }
  await load()
}

function handlePrevious() {
  if (!hasPrevious.value) return
  page.value -= 1
  void load()
}

function handleNext() {
  if (!hasNext.value) return
  page.value += 1
  void load()
}

watch(
  () => props.bookId,
  () => {
    page.value = 1
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-xs)]" aria-label="Reading history">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-foreground">Reading history</h3>
        <p class="text-xs text-muted-foreground">{{ total }} recorded attempt{{ total === 1 ? '' : 's' }}</p>
      </div>
      <div class="flex gap-2">
        <button class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium" @click="handleToggleAdd">
          <Plus class="size-3.5" /> Add past attempt
        </button>
        <button
          v-if="canManageDestructive"
          class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
          @click="handleToggleStart"
        >
          <RotateCcw class="size-3.5" /> Start reread
        </button>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-xs text-destructive">{{ error }}</p>

    <div v-if="startOpen" class="mt-3 rounded-lg border border-border bg-background p-3">
      <p class="text-sm font-medium">Start a new reading attempt?</p>
      <label class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <input v-model="resetProgress" type="checkbox" class="size-4 rounded border-input" />
        Reset reading position to the beginning. Synchronized devices may receive this reset.
      </label>
      <div class="mt-3 flex gap-2">
        <button class="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground" :disabled="saving" @click="handleStartReread">
          Start reread
        </button>
        <button class="h-8 rounded-md border border-border px-3 text-xs" :disabled="saving" @click="handleToggleStart">Cancel</button>
      </div>
    </div>

    <div v-if="addOpen" class="mt-3 grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-3">
      <label class="text-xs text-muted-foreground"
        >Started <input v-model="startedOn" type="date" class="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-foreground"
      /></label>
      <label class="text-xs text-muted-foreground"
        >Ended <input v-model="endedOn" type="date" class="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-foreground"
      /></label>
      <label class="text-xs text-muted-foreground"
        >Outcome
        <select v-model="outcome" class="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-foreground">
          <option value="completed">Completed</option>
          <option value="skimmed">Skimmed</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </label>
      <div class="flex gap-2 sm:col-span-3">
        <button
          class="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs text-primary-foreground"
          :disabled="saving"
          @click="handleSaveAttempt"
        >
          <Check class="size-3.5" /> Save
        </button>
        <button class="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs" :disabled="saving" @click="handleToggleAdd">
          <X class="size-3.5" /> Cancel
        </button>
      </div>
    </div>

    <div class="mt-3 overflow-x-auto">
      <table class="w-full min-w-[560px] text-left text-sm">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="py-2">Outcome</th>
            <th>Started</th>
            <th>Ended</th>
            <th>Source</th>
            <th>Activity</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="attempt in attempts" :key="attempt.id">
            <template v-if="editingId === attempt.id">
              <td class="py-2">
                <select v-model="outcome" class="h-8 rounded border border-input bg-background px-1">
                  <option value="completed">Completed</option>
                  <option value="skimmed">Skimmed</option>
                  <option value="abandoned">Abandoned</option>
                </select>
              </td>
              <td><input v-model="startedOn" type="date" class="h-8 rounded border border-input bg-background px-1" /></td>
              <td><input v-model="endedOn" type="date" class="h-8 rounded border border-input bg-background px-1" /></td>
              <td>{{ attempt.origin }}</td>
              <td>{{ attempt.totalSessions }} sessions</td>
              <td class="text-right">
                <button class="p-1" aria-label="Save attempt" @click="handleSaveAttempt"><Check class="size-4" /></button
                ><button class="p-1" aria-label="Cancel edit" @click="handleCancelEdit"><X class="size-4" /></button>
              </td>
            </template>
            <template v-else>
              <td class="py-2 font-medium text-foreground">{{ outcomeLabel(attempt.outcome) }}</td>
              <td>{{ formatDate(attempt.startedOn) }}</td>
              <td>{{ formatDate(attempt.endedOn) }}</td>
              <td class="capitalize">{{ attempt.origin }}</td>
              <td>{{ attempt.totalSessions }} sessions</td>
              <td class="text-right">
                <button class="p-1 text-muted-foreground hover:text-foreground" aria-label="Edit attempt" @click="handleEdit(attempt)">
                  <Pencil class="size-4" /></button
                ><button
                  v-if="canManageDestructive"
                  class="p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Delete attempt"
                  @click="handleDelete(attempt)"
                >
                  <Trash2 class="size-4" />
                </button>
              </td>
            </template>
          </tr>
          <tr v-if="!loading && attempts.length === 0">
            <td colspan="6" class="py-6 text-center text-sm text-muted-foreground">No reading attempts recorded.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="hasPrevious || hasNext" class="mt-3 flex justify-end gap-2">
      <button class="h-8 rounded border border-border px-3 text-xs disabled:opacity-50" :disabled="!hasPrevious" @click="handlePrevious">
        Previous
      </button>
      <button class="h-8 rounded border border-border px-3 text-xs disabled:opacity-50" :disabled="!hasNext" @click="handleNext">Next</button>
    </div>
  </section>
</template>
