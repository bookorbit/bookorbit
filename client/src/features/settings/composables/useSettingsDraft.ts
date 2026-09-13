import { computed, ref, type Ref } from 'vue'

/**
 * The lifecycle every settings editor sheet shares: one record being edited, whether it has been
 * touched since it opened, and whether its sheet is on screen.
 *
 * Extracted because the indexer editor and the download client editor had the same four pieces of
 * state written out twice, and the second copy had already drifted. What is not shared is the
 * record itself and its secret field: an indexer holds an API key and a client holds a password,
 * with different rules about clearing them, and generalising that would cost more indirection than
 * the two dozen lines it saves.
 *
 * `open` is deliberately separate from `draft !== null`, and closing leaves the record behind.
 * Dropping it in the same tick as `open` goes false is what made the sheet vanish instead of
 * sliding away: the form it renders unmounts before the exit animation has a frame to run in. The
 * record left behind is invisible - the sheet it belongs to is closed - and the next `start`
 * replaces it.
 */
export interface SettingsDraft<T> {
  /** The record being edited, or the last one edited once its sheet has been closed. */
  draft: Ref<T | null>
  /** Whether the sheet is on screen. This, not the record, is what the sheet binds to. */
  open: Ref<boolean>
  /** Whether the *open* editor has anything typed into it that has not been saved. */
  isDirty: Ref<boolean>
  /** Opens the editor on a record, discarding whatever was there. */
  start: (next: T) => void
  /** Treats the draft as it currently stands as untouched, after a save or a settled first step. */
  markPristine: () => void
  /** Closes the editor. The record stays until the next one replaces it. */
  close: () => void
}

export function useSettingsDraft<T extends object>(): SettingsDraft<T> {
  const draft = ref<T | null>(null) as Ref<T | null>
  const open = ref(false)
  /** The draft as it was opened, serialized, so closing can tell a typo from an untouched form. */
  const pristine = ref('')

  // Gated on `open`, because a closed editor has nothing unsaved: the record it left behind must
  // not go on reporting itself dirty to the list behind it, where it would disable Test forever.
  const isDirty = computed(() => open.value && draft.value !== null && JSON.stringify(draft.value) !== pristine.value)

  function start(next: T) {
    draft.value = next
    pristine.value = JSON.stringify(next)
    open.value = true
  }

  function markPristine() {
    if (draft.value) pristine.value = JSON.stringify(draft.value)
  }

  function close() {
    open.value = false
  }

  return { draft, open, isDirty, start, markPristine, close }
}
