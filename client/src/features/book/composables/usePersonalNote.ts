import { computed, ref, watch, type Ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import { api } from '@/lib/api'

export const PERSONAL_NOTE_MAX_LENGTH = 10000

function normalizePersonalNoteValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export function usePersonalNote(book: Ref<BookDetail>) {
  const draft = ref('')
  const editing = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const preview = computed(() => normalizePersonalNoteValue(book.value.personalNote) ?? '')
  const hasNote = computed(() => preview.value.length > 0)
  const normalizedDraft = computed(() => normalizePersonalNoteValue(draft.value))
  const normalizedSaved = computed(() => normalizePersonalNoteValue(book.value.personalNote))
  const hasChanges = computed(() => normalizedDraft.value !== normalizedSaved.value)
  const canSave = computed(() => hasChanges.value && !saving.value)
  const canClearDraft = computed(() => normalizedDraft.value !== null)
  const charCount = computed(() => draft.value.length)

  function resetDraft() {
    draft.value = book.value.personalNote ?? ''
    error.value = null
    editing.value = false
  }

  watch(() => [book.value.id, book.value.personalNote] as const, resetDraft, { immediate: true })

  function startEdit() {
    if (saving.value) return
    draft.value = book.value.personalNote ?? ''
    error.value = null
    editing.value = true
  }

  function cancelEdit() {
    if (saving.value) return
    draft.value = book.value.personalNote ?? ''
    error.value = null
    editing.value = false
  }

  function clearDraft() {
    if (saving.value) return
    draft.value = ''
  }

  async function save(): Promise<BookDetail | null> {
    if (!canSave.value) return null
    saving.value = true
    error.value = null

    try {
      const res = await api(`/api/v1/books/${book.value.id}/personal-note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: normalizedDraft.value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated = (await res.json()) as BookDetail
      draft.value = updated.personalNote ?? ''
      editing.value = false
      return updated
    } catch {
      error.value = 'Failed to save personal review.'
      return null
    } finally {
      saving.value = false
    }
  }

  return {
    draft,
    editing,
    saving,
    error,
    preview,
    hasNote,
    canSave,
    canClearDraft,
    charCount,
    startEdit,
    cancelEdit,
    clearDraft,
    save,
  }
}
