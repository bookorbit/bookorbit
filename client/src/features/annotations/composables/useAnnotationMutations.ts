import { ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'

export interface AnnotationPatch {
  note?: string | null
  color?: string
  style?: string
}

type Editable = { id: number; bookId: number; note?: string | null; color?: string; style?: string }

/**
 * Shared per-item note/color/style editing for an annotation list: optimistic local patch,
 * book-scoped PATCH, revert on failure, and per-id saving state. `resolveBookId` lets the hub
 * look the book up per item while a single-book view returns a constant.
 */
export function useAnnotationMutations<T extends Editable>(items: Ref<T[]>, resolveBookId: (id: number) => number | null) {
  const savingIds = ref<Set<number>>(new Set())

  function setSaving(id: number, saving: boolean) {
    const next = new Set(savingIds.value)
    if (saving) next.add(id)
    else next.delete(id)
    savingIds.value = next
  }

  async function patch(id: number, body: AnnotationPatch) {
    const bookId = resolveBookId(id)
    if (bookId == null) return
    const previous = items.value
    items.value = items.value.map((item) => (item.id === id ? { ...item, ...body } : item))
    setSaving(id, true)
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) items.value = previous
    } catch {
      items.value = previous
    } finally {
      setSaving(id, false)
    }
  }

  function updateNote(id: number, note: string | null) {
    return patch(id, { note })
  }

  function updateColor(id: number, color: string) {
    return patch(id, { color })
  }

  function updateStyle(id: number, style: string) {
    return patch(id, { style })
  }

  watch(items, (nextItems) => {
    const currentIds = new Set(nextItems.map((item) => item.id))
    const pruned = new Set([...savingIds.value].filter((id) => currentIds.has(id)))
    if (pruned.size !== savingIds.value.size) savingIds.value = pruned
  })

  return { savingIds, setSaving, updateNote, updateColor, updateStyle }
}
