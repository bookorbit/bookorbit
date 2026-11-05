<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { ReadStatus } from '@bookorbit/types'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { STATUS_OPTIONS, type BulkReadingStatePatch } from '@/features/book/composables/useBookStatus'

type DateMode = 'set' | 'clear'

const props = defineProps<{
  open: boolean
  bookCount: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [patch: BulkReadingStatePatch]
}>()

const { t } = useI18n()
const status = ref<ReadStatus>('read')
const startedAtEnabled = ref(false)
const startedAtMode = ref<DateMode>('set')
const startedAt = ref('')
const finishedAtEnabled = ref(true)
const finishedAtMode = ref<DateMode>('clear')
const finishedAt = ref('')

const STATUS_LABEL_KEYS: Record<ReadStatus, string> = {
  unread: 'book.readStatus.unread',
  want_to_read: 'book.readStatus.wantToRead',
  reading: 'book.readStatus.reading',
  on_hold: 'book.readStatus.onHold',
  rereading: 'book.readStatus.rereading',
  read: 'book.readStatus.read',
  skimmed: 'book.readStatus.skimmed',
  abandoned: 'book.readStatus.abandoned',
}

const localizedStatusOptions = computed(() => STATUS_OPTIONS.map((option) => ({ ...option, label: t(STATUS_LABEL_KEYS[option.value]) })))

const today = computed(() => {
  const value = new Date()
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
})

const validationError = computed(() => {
  const start = startedAtEnabled.value && startedAtMode.value === 'set' ? startedAt.value : ''
  const finish = finishedAtEnabled.value && finishedAtMode.value === 'set' ? finishedAt.value : ''
  if (startedAtEnabled.value && startedAtMode.value === 'set' && !start) return t('book.bulkReadingState.errors.startRequired')
  if (finishedAtEnabled.value && finishedAtMode.value === 'set' && !finish) return t('book.bulkReadingState.errors.finishRequired')
  if (start && start > today.value) return t('book.bulkReadingState.errors.startFuture')
  if (finish && finish > today.value) return t('book.bulkReadingState.errors.finishFuture')
  if (start && finish && finish < start) return t('book.bulkReadingState.errors.finishBeforeStart')
  if ((start || finish) && ['unread', 'want_to_read'].includes(status.value)) {
    return t('book.bulkReadingState.errors.statusConflict')
  }
  if (finish && ['unread', 'want_to_read', 'reading', 'rereading', 'on_hold'].includes(status.value)) {
    return t('book.bulkReadingState.errors.statusConflict')
  }
  return null
})

function resetForm() {
  status.value = 'read'
  startedAtEnabled.value = false
  startedAtMode.value = 'set'
  startedAt.value = ''
  finishedAtEnabled.value = true
  finishedAtMode.value = 'clear'
  finishedAt.value = ''
}

function handleClose() {
  emit('update:open', false)
}

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}

function handleConfirm() {
  if (validationError.value) return
  const patch: BulkReadingStatePatch = { status: status.value }
  if (startedAtEnabled.value) patch.startedAt = startedAtMode.value === 'clear' ? null : startedAt.value
  if (finishedAtEnabled.value) patch.finishedAt = finishedAtMode.value === 'clear' ? null : finishedAt.value
  emit('confirm', patch)
}

watch(
  () => props.open,
  (open) => {
    if (!open) resetForm()
  },
)
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <header class="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <DialogTitle class="text-lg font-semibold text-foreground">
              {{ t('book.bulkReadingState.title', { count: bookCount }) }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t('book.bulkReadingState.description') }}</DialogDescription>
          </div>
          <button
            type="button"
            class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('book.bulkReadingState.close')"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </header>

        <form class="space-y-5 px-6 py-5" @submit.prevent="handleConfirm">
          <div class="space-y-2">
            <label for="bulk-reading-status" class="text-sm font-medium text-foreground">{{ t('book.bulkReadingState.status') }}</label>
            <select
              id="bulk-reading-status"
              v-model="status"
              class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option v-for="option in localizedStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>

          <fieldset class="space-y-3 rounded-lg border border-border p-4">
            <label class="flex items-center gap-3 text-sm font-medium text-foreground">
              <input v-model="startedAtEnabled" type="checkbox" class="h-4 w-4 rounded border-input text-primary focus:ring-ring" />
              {{ t('book.bulkReadingState.startedAt') }}
            </label>
            <div v-if="startedAtEnabled" class="grid gap-3 pl-7 sm:grid-cols-[9rem_1fr]">
              <label class="sr-only" for="bulk-started-at-mode">{{ t('book.bulkReadingState.dateAction') }}</label>
              <select
                id="bulk-started-at-mode"
                v-model="startedAtMode"
                class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="set">{{ t('book.bulkReadingState.setDate') }}</option>
                <option value="clear">{{ t('book.bulkReadingState.clearDate') }}</option>
              </select>
              <label class="sr-only" for="bulk-started-at">{{ t('book.bulkReadingState.startedAt') }}</label>
              <input
                v-if="startedAtMode === 'set'"
                id="bulk-started-at"
                v-model="startedAt"
                type="date"
                :max="today"
                class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p v-else class="self-center text-sm text-muted-foreground">{{ t('book.bulkReadingState.clearStartedHint') }}</p>
            </div>
          </fieldset>

          <fieldset class="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <label class="flex items-center gap-3 text-sm font-medium text-foreground">
              <input v-model="finishedAtEnabled" type="checkbox" class="h-4 w-4 rounded border-input text-primary focus:ring-ring" />
              {{ t('book.bulkReadingState.finishedAt') }}
            </label>
            <div v-if="finishedAtEnabled" class="grid gap-3 pl-7 sm:grid-cols-[9rem_1fr]">
              <label class="sr-only" for="bulk-finished-at-mode">{{ t('book.bulkReadingState.dateAction') }}</label>
              <select
                id="bulk-finished-at-mode"
                v-model="finishedAtMode"
                class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="clear">{{ t('book.bulkReadingState.noFinishDate') }}</option>
                <option value="set">{{ t('book.bulkReadingState.setDate') }}</option>
              </select>
              <label class="sr-only" for="bulk-finished-at">{{ t('book.bulkReadingState.finishedAt') }}</label>
              <input
                v-if="finishedAtMode === 'set'"
                id="bulk-finished-at"
                v-model="finishedAt"
                type="date"
                :max="today"
                class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p v-else class="self-center text-sm text-muted-foreground">{{ t('book.bulkReadingState.noFinishDateHint') }}</p>
            </div>
          </fieldset>

          <p v-if="validationError" role="alert" class="text-sm text-destructive">{{ validationError }}</p>

          <footer class="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              class="h-9 rounded-md px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="handleClose"
            >
              {{ t('book.bulkReadingState.cancel') }}
            </button>
            <button
              type="submit"
              :disabled="Boolean(validationError)"
              class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ t('book.bulkReadingState.apply') }}
            </button>
          </footer>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
