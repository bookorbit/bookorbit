import { computed, reactive, ref, type Ref } from 'vue'
import { apiJson, jsonBody } from '@/lib/api-json'

/** Both metadata endpoints answer with the stored record, including the lock set they just wrote. */
export interface LockedMetadataRecord {
  lockedFields: string[]
}

export interface LockedMetadataFormConfig<
  Form extends object,
  Field extends string,
  LockedField extends string,
  Loaded extends LockedMetadataRecord,
> {
  emptyForm: () => Form
  /** The fields the form renders a control for, in the order the payload is built. */
  fields: readonly Field[]
  /** Every lockable field, including ones the form has no control for yet. */
  lockable: readonly LockedField[]
  /** Copies a loaded record onto the form. The lock set is read off the record separately. */
  apply: (form: Form, record: Loaded) => void
  /** The comparable projection of one field; anything non-primitive is compared by its JSON. */
  normalize: (field: Field, form: Form) => unknown
  /** The value the API expects for one changed field. The field id doubles as the payload key. */
  toPayload: (field: Field, form: Form) => unknown
  endpoint: (id: number) => string
  fallbackKey: string
}

/**
 * The half of a metadata editor that is the same for shows and episodes: a snapshot diff against
 * the loaded record, the lock set with its optimistic `willLock` preview, a sparse PATCH built from
 * only the changed fields, and the save that re-snapshots from the server's answer.
 *
 * Callers add what differs: which fields exist, how each is normalized and serialized, and any
 * field-specific derived state.
 */
export function createLockedMetadataForm<
  Form extends object,
  Field extends string,
  LockedField extends string,
  Loaded extends LockedMetadataRecord,
  Payload extends object,
>(config: LockedMetadataFormConfig<Form, Field, LockedField, Loaded>) {
  const form = reactive(config.emptyForm()) as Form
  const lockedFields = ref([]) as Ref<LockedField[]>
  const saving = ref(false)
  const error = ref<string | null>(null)
  const snapshot = ref(JSON.stringify(form))
  const lockSnapshot = ref('[]')

  const locksChanged = computed(() => JSON.stringify(lockedFields.value) !== lockSnapshot.value)
  const isDirty = computed(() => JSON.stringify(form) !== snapshot.value || locksChanged.value)
  const changedFields = computed<Field[]>(() => {
    const previous = JSON.parse(snapshot.value) as Form
    return config.fields.filter((field) => JSON.stringify(config.normalize(field, form)) !== JSON.stringify(config.normalize(field, previous)))
  })
  /** Whitespace-only edits leave nothing to send, so dirtiness alone cannot decide whether to save. */
  const hasChanges = computed(() => changedFields.value.length > 0 || locksChanged.value)

  function load(record: Loaded) {
    config.apply(form, record)
    lockedFields.value = config.lockable.filter((field) => (record.lockedFields ?? []).includes(field))
    snapshot.value = JSON.stringify(form)
    lockSnapshot.value = JSON.stringify(lockedFields.value)
    error.value = null
  }

  function reset() {
    Object.assign(form, JSON.parse(snapshot.value) as Form)
    lockedFields.value = JSON.parse(lockSnapshot.value) as LockedField[]
    error.value = null
  }

  function isLocked(field: LockedField): boolean {
    return lockedFields.value.includes(field)
  }

  /** A changed field is shown as locked before saving, because the server locks it on write. */
  function willLock(field: LockedField): boolean {
    return !isLocked(field) && (config.fields as readonly string[]).includes(field) && (changedFields.value as readonly string[]).includes(field)
  }

  function toggleLock(field: LockedField) {
    lockedFields.value = isLocked(field)
      ? lockedFields.value.filter((locked) => locked !== field)
      : config.lockable.filter((locked) => locked === field || isLocked(locked))
  }

  function buildPayload(): Payload {
    const payload: Record<string, unknown> = {}
    for (const field of changedFields.value) payload[field] = config.toPayload(field, form)
    if (locksChanged.value) payload.lockedFields = [...lockedFields.value]
    return payload as Payload
  }

  async function save(id: number): Promise<Loaded | null> {
    const payload = buildPayload()
    if (Object.keys(payload).length === 0) return null
    saving.value = true
    error.value = null
    try {
      const result = await apiJson<Loaded>(config.endpoint(id), jsonBody('PATCH', payload), config.fallbackKey)
      load(result)
      return result
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : null
      return null
    } finally {
      saving.value = false
    }
  }

  return {
    form,
    lockedFields,
    saving,
    error,
    isDirty,
    hasChanges,
    changedFields,
    load,
    reset,
    isLocked,
    willLock,
    toggleLock,
    buildPayload,
    save,
  }
}
