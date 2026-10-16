import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { CustomMetadataFieldDefinition, CustomMetadataFieldType } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { api } from '@/lib/api'
import { useActiveCustomFields } from '@/features/book/composables/useActiveCustomFields'

type CreateFieldPayload = {
  label: string
  type: CustomMetadataFieldType
  enabledLibraryIds: number[]
}

type UpdateFieldPayload = {
  label: string
  enabledLibraryIds: number[]
}

export function useCustomMetadataFields() {
  const { refresh: refreshActiveFields } = useActiveCustomFields()
  const fields = ref<CustomMetadataFieldDefinition[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const creating = ref(false)
  const savingId = ref<number | null>(null)
  const archivingId = ref<number | null>(null)
  const restoringId = ref<number | null>(null)
  const deletingPermanentlyId = ref<number | null>(null)
  const reordering = ref(false)

  const activeFields = computed(() =>
    [...fields.value].filter((f) => !f.archivedAt).sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label)),
  )

  const archivedFields = computed(() =>
    [...fields.value].filter((f) => f.archivedAt).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
  )

  function replace(updated: CustomMetadataFieldDefinition) {
    fields.value = fields.value.map((item) => (item.id === updated.id ? updated : item))
  }

  async function loadFields(): Promise<void> {
    loading.value = true
    try {
      const res = await api('/api/v1/custom-metadata/fields?includeArchived=true')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fields.value = (await res.json()) as CustomMetadataFieldDefinition[]
      loaded.value = true
    } catch {
      toast.error(i18n.global.t('settings.metadata.customFields.toasts.loadFailed'))
    } finally {
      loading.value = false
    }
  }

  async function createField(payload: CreateFieldPayload): Promise<CustomMetadataFieldDefinition | null> {
    creating.value = true
    try {
      const res = await api('/api/v1/custom-metadata/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // After the last field, not at the active count: archiving leaves gaps, and a tie sorts by label.
        body: JSON.stringify({ ...payload, displayOrder: Math.max(-1, ...fields.value.map((field) => field.displayOrder)) + 1 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const created = (await res.json()) as CustomMetadataFieldDefinition
      fields.value = [...fields.value, created]
      toast.success(i18n.global.t('settings.metadata.customFields.toasts.created', { label: created.label }))
      void refreshActiveFields()
      return created
    } catch {
      toast.error(i18n.global.t('settings.metadata.customFields.toasts.createFailed', { label: payload.label }))
      return null
    } finally {
      creating.value = false
    }
  }

  async function saveField(field: CustomMetadataFieldDefinition, payload: UpdateFieldPayload): Promise<CustomMetadataFieldDefinition | null> {
    savingId.value = field.id
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated = (await res.json()) as CustomMetadataFieldDefinition
      replace(updated)
      toast.success(i18n.global.t('settings.metadata.customFields.toasts.saved', { label: updated.label }))
      void refreshActiveFields()
      return updated
    } catch {
      toast.error(i18n.global.t('settings.metadata.customFields.toasts.saveFailed', { label: field.label }))
      return null
    } finally {
      savingId.value = null
    }
  }

  async function restoreField(field: CustomMetadataFieldDefinition, { quiet = false } = {}): Promise<boolean> {
    restoringId.value = field.id
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${field.id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fields.value = fields.value.map((item) => (item.id === field.id ? { ...item, archivedAt: null } : item))
      if (!quiet) toast.success(i18n.global.t('settings.metadata.customFields.toasts.restored', { label: field.label }))
      void refreshActiveFields()
      return true
    } catch {
      toast.error(i18n.global.t('settings.metadata.customFields.toasts.restoreFailed', { label: field.label }))
      return false
    } finally {
      restoringId.value = null
    }
  }

  /** Archiving is reversible, so it runs at once and offers Undo instead of asking first. */
  async function archiveField(field: CustomMetadataFieldDefinition): Promise<boolean> {
    archivingId.value = field.id
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${field.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const now = new Date().toISOString()
      fields.value = fields.value.map((item) => (item.id === field.id ? { ...item, archivedAt: now } : item))
      toast.success(i18n.global.t('settings.metadata.customFields.toasts.archived', { label: field.label }), {
        action: { label: i18n.global.t('common.undo'), onClick: () => void restoreField(field, { quiet: true }) },
      })
      void refreshActiveFields()
      return true
    } catch {
      toast.error(i18n.global.t('settings.metadata.customFields.toasts.archiveFailed', { label: field.label }))
      return false
    } finally {
      archivingId.value = null
    }
  }

  async function deleteFieldPermanently(field: CustomMetadataFieldDefinition): Promise<boolean> {
    deletingPermanentlyId.value = field.id
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${field.id}/permanent`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fields.value = fields.value.filter((item) => item.id !== field.id)
      toast.success(i18n.global.t('settings.metadata.customFields.toasts.deleted', { label: field.label }))
      void refreshActiveFields()
      return true
    } catch {
      toast.error(i18n.global.t('settings.metadata.customFields.toasts.deleteFailed', { label: field.label }))
      return false
    } finally {
      deletingPermanentlyId.value = null
    }
  }

  async function reorderFields(orderedIds: number[]): Promise<boolean> {
    reordering.value = true
    try {
      const res = await api('/api/v1/custom-metadata/fields/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reordered = (await res.json()) as CustomMetadataFieldDefinition[]
      const archived = fields.value.filter((item) => item.archivedAt)
      fields.value = [...reordered, ...archived]
      void refreshActiveFields()
      return true
    } catch {
      toast.error(i18n.global.t('settings.metadata.customFields.toasts.reorderFailed'))
      await loadFields()
      return false
    } finally {
      reordering.value = false
    }
  }

  /** The keyboard and menu path to reordering, alongside drag. */
  async function moveField(field: CustomMetadataFieldDefinition, step: -1 | 1): Promise<boolean> {
    const ids = activeFields.value.map((item) => item.id)
    const from = ids.indexOf(field.id)
    const to = from + step
    if (from < 0 || to < 0 || to >= ids.length) return false
    ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
    return reorderFields(ids)
  }

  return {
    fields,
    loading,
    loaded,
    creating,
    savingId,
    archivingId,
    restoringId,
    deletingPermanentlyId,
    reordering,
    activeFields,
    archivedFields,
    loadFields,
    createField,
    saveField,
    archiveField,
    restoreField,
    deleteFieldPermanently,
    reorderFields,
    moveField,
  }
}
