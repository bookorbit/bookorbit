import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'
import type { FieldPreference, FieldPreferenceOverrides, MetadataField, MetadataFetchPreferences, MetadataProviderKey } from '@bookorbit/types'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useMetadataPreferences } from './useMetadataPreferences'
import { applyProviderAction, type ProviderBulkAction } from '../lib/field-rules'

export const GLOBAL_SCOPE = 'global' as const
export type FieldRuleScopeId = typeof GLOBAL_SCOPE | number

export interface FieldRuleScope {
  id: FieldRuleScopeId
  name: string
  isGlobal: boolean
  /** Fields this scope overrides, counting unsaved edits. Always 0 for the global scope. */
  overrideCount: number
  unsavedCount: number
  loaded: boolean
}

/**
 * The effective field set the table renders, plus the edits not yet sent to the server.
 * A pending value of `null` means "stop overriding this field" and only occurs on a library.
 */
interface ScopeDraft {
  fields: Record<MetadataField, FieldPreference>
  pending: Map<MetadataField, FieldPreference | null>
}

function cloneFields(fields: Record<MetadataField, FieldPreference>): Record<MetadataField, FieldPreference> {
  const next = {} as Record<MetadataField, FieldPreference>
  for (const field of ALL_METADATA_FIELDS) {
    const pref = fields[field]
    next[field] = { enabled: pref.enabled, mergeStrategy: pref.mergeStrategy, providers: [...pref.providers] }
  }
  return next
}

function draftKey(id: FieldRuleScopeId): string {
  return id === GLOBAL_SCOPE ? GLOBAL_SCOPE : `library:${id}`
}

/**
 * Owns the field-rule editing session: which scope is on screen, its draft, and what has
 * changed. Drafts are kept per scope so switching tabs does not discard unsaved work, and
 * a library's rules are only fetched the first time its tab is opened.
 */
export function useFieldRuleScopes() {
  const { t } = useI18n()
  const { libraries, fetchLibraries } = useLibraries()
  const prefs = useMetadataPreferences()

  const activeScopeId = ref<FieldRuleScopeId>(GLOBAL_SCOPE)
  const drafts = ref<Map<string, ScopeDraft>>(new Map())
  const optionsDraft = ref<MetadataFetchPreferences['options'] | null>(null)
  const optionsDirty = ref(false)
  const requestedLibraries = new Set<number>()
  const loadingScope = ref(false)

  function draftFor(id: FieldRuleScopeId): ScopeDraft | null {
    return drafts.value.get(draftKey(id)) ?? null
  }

  function writeDraft(id: FieldRuleScopeId, draft: ScopeDraft) {
    drafts.value = new Map(drafts.value).set(draftKey(id), draft)
  }

  /** Rebuilds a draft from server state, leaving a scope with unsaved edits untouched. */
  function seedDraft(id: FieldRuleScopeId, fields: Record<MetadataField, FieldPreference>) {
    const existing = draftFor(id)
    if (existing && existing.pending.size > 0) return
    writeDraft(id, { fields: cloneFields(fields), pending: new Map() })
  }

  watch(
    () => prefs.globalPrefs.value,
    (value) => {
      if (!value) return
      seedDraft(GLOBAL_SCOPE, value.fields)
      if (!optionsDirty.value) seedOptions(value)
    },
    { immediate: true },
  )

  watch(
    () => prefs.libraryPrefs.value,
    (map) => {
      for (const [libraryId, entry] of map) seedDraft(libraryId, entry.effective.fields)
    },
    { immediate: true, deep: false },
  )

  function seedOptions(source: MetadataFetchPreferences) {
    optionsDraft.value = {
      genres: {
        mode: source.options?.genres.mode ?? 'merge',
        blocklist: source.options?.genres.blocklist ?? [],
        maxCount: source.options?.genres.maxCount ?? null,
      },
      saveProviderIds: source.options?.saveProviderIds ?? true,
      providerIdMode: source.options?.providerIdMode ?? 'preferExisting',
    }
  }

  async function loadScope(id: FieldRuleScopeId) {
    if (id === GLOBAL_SCOPE || requestedLibraries.has(id)) return
    requestedLibraries.add(id)
    loadingScope.value = true
    try {
      await prefs.fetchLibrary(id)
    } finally {
      loadingScope.value = false
    }
  }

  watch(activeScopeId, (id) => void loadScope(id), { immediate: true })

  const activeDraft = computed(() => draftFor(activeScopeId.value))
  const activeFields = computed(() => activeDraft.value?.fields ?? null)
  const isGlobalScope = computed(() => activeScopeId.value === GLOBAL_SCOPE)

  /** Fields the active library overrides, including unsaved edits. Empty on the global scope. */
  const overriddenFields = computed<Set<MetadataField>>(() => {
    if (isGlobalScope.value) return new Set()
    const saved = prefs.libraryPrefs.value.get(activeScopeId.value as number)?.overrides ?? {}
    const result = new Set(Object.keys(saved) as MetadataField[])
    for (const [field, pref] of activeDraft.value?.pending ?? []) {
      if (pref === null) result.delete(field)
      else result.add(field)
    }
    return result
  })

  const unsavedFields = computed(() => new Set(activeDraft.value?.pending.keys() ?? []))
  const isDirty = computed(() => unsavedFields.value.size > 0 || (isGlobalScope.value && optionsDirty.value))

  const scopes = computed<FieldRuleScope[]>(() => {
    const globalDraft = drafts.value.get(GLOBAL_SCOPE)
    const entries: FieldRuleScope[] = [
      {
        id: GLOBAL_SCOPE,
        name: t('settings.metadata.fieldRules.scope.global'),
        isGlobal: true,
        overrideCount: 0,
        unsavedCount: (globalDraft?.pending.size ?? 0) + (optionsDirty.value ? 1 : 0),
        loaded: Boolean(globalDraft),
      },
    ]
    for (const library of libraries.value) {
      const saved = prefs.libraryPrefs.value.get(library.id)?.overrides ?? {}
      const pending = drafts.value.get(draftKey(library.id))?.pending ?? new Map<MetadataField, FieldPreference | null>()
      const overrides = new Set(Object.keys(saved) as MetadataField[])
      for (const [field, pref] of pending) {
        if (pref === null) overrides.delete(field)
        else overrides.add(field)
      }
      entries.push({
        id: library.id,
        name: library.name,
        isGlobal: false,
        overrideCount: overrides.size,
        unsavedCount: pending.size,
        loaded: prefs.libraryPrefs.value.has(library.id),
      })
    }
    return entries
  })

  const activeScope = computed(() => scopes.value.find((scope) => scope.id === activeScopeId.value) ?? scopes.value[0]!)
  const saving = computed(() => (isGlobalScope.value ? prefs.savingGlobal.value : prefs.savingLibrary.value === activeScopeId.value))

  function setField(field: MetadataField, pref: FieldPreference) {
    const draft = activeDraft.value
    if (!draft || saving.value) return
    const pending = new Map(draft.pending).set(field, pref)
    writeDraft(activeScopeId.value, { fields: { ...draft.fields, [field]: pref }, pending })
  }

  function patchField(field: MetadataField, patch: Partial<FieldPreference>) {
    const current = activeFields.value?.[field]
    if (!current) return
    setField(field, { ...current, ...patch })
  }

  /** Drops a library override so the field inherits the global rule again. */
  function revertField(field: MetadataField) {
    const draft = activeDraft.value
    const globalPref = prefs.globalPrefs.value?.fields[field]
    if (!draft || isGlobalScope.value || !globalPref || saving.value) return
    const pending = new Map(draft.pending).set(field, null)
    writeDraft(activeScopeId.value, { fields: { ...draft.fields, [field]: { ...globalPref, providers: [...globalPref.providers] } }, pending })
  }

  function updateEveryField(update: (pref: FieldPreference) => FieldPreference) {
    const draft = activeDraft.value
    if (!draft || saving.value) return
    const fields = { ...draft.fields }
    const pending = new Map(draft.pending)
    for (const field of ALL_METADATA_FIELDS) {
      const next = update(fields[field])
      if (next === fields[field]) continue
      fields[field] = next
      pending.set(field, next)
    }
    writeDraft(activeScopeId.value, { fields, pending })
  }

  function clearAllProviders() {
    updateEveryField((pref) => (pref.providers.length === 0 ? pref : { ...pref, providers: [] }))
  }

  /** Moves or removes one provider across every field in the active scope. */
  function applyProviderToAllFields(provider: MetadataProviderKey, action: ProviderBulkAction) {
    updateEveryField((pref) => {
      const providers = applyProviderAction(pref.providers, provider, action)
      return providers.length === pref.providers.length && providers.every((key, index) => key === pref.providers[index])
        ? pref
        : { ...pref, providers }
    })
  }

  function setOptions(options: MetadataFetchPreferences['options']) {
    optionsDraft.value = options
    optionsDirty.value = true
  }

  function discard() {
    const id = activeScopeId.value
    const next = new Map(drafts.value)
    next.delete(draftKey(id))
    drafts.value = next
    if (id === GLOBAL_SCOPE) {
      optionsDirty.value = false
      if (prefs.globalPrefs.value) {
        seedDraft(GLOBAL_SCOPE, prefs.globalPrefs.value.fields)
        seedOptions(prefs.globalPrefs.value)
      }
    } else {
      const entry = prefs.libraryPrefs.value.get(id)
      if (entry) seedDraft(id, entry.effective.fields)
    }
  }

  async function save(): Promise<boolean> {
    const draft = activeDraft.value
    if (!draft || !isDirty.value) return false

    if (isGlobalScope.value) {
      const base = prefs.globalPrefs.value
      if (!base) return false
      const saved = await prefs.saveGlobal({ ...base, fields: draft.fields, options: optionsDraft.value ?? base.options })
      if (saved) {
        optionsDirty.value = false
        writeDraft(GLOBAL_SCOPE, { fields: draft.fields, pending: new Map() })
        // Library rules merge over the global ones, so every cached effective view is now stale.
        for (const libraryId of requestedLibraries) void prefs.fetchLibrary(libraryId)
      }
      return saved
    }

    const libraryId = activeScopeId.value as number
    const overrides: FieldPreferenceOverrides = { ...prefs.libraryPrefs.value.get(libraryId)?.overrides }
    for (const [field, pref] of draft.pending) {
      if (pref === null) delete overrides[field]
      else overrides[field] = pref
    }
    const saved = await prefs.saveLibraryDraft(libraryId, overrides)
    if (saved) writeDraft(libraryId, { fields: draft.fields, pending: new Map() })
    return saved
  }

  async function resetScope(): Promise<void> {
    const id = activeScopeId.value
    const next = new Map(drafts.value)
    next.delete(draftKey(id))
    drafts.value = next
    if (id === GLOBAL_SCOPE) {
      optionsDirty.value = false
      await prefs.resetGlobal()
    } else {
      await prefs.resetLibrary(id)
    }
  }

  async function load(): Promise<void> {
    await Promise.all([prefs.fetchGlobal(), fetchLibraries()])
  }

  return {
    activeScopeId,
    activeScope,
    scopes,
    activeFields,
    isGlobalScope,
    overriddenFields,
    unsavedFields,
    isDirty,
    saving,
    loading: prefs.loadingGlobal,
    loadingScope,
    optionsDraft,
    globalPrefs: prefs.globalPrefs,
    load,
    setField,
    patchField,
    revertField,
    clearAllProviders,
    applyProviderToAllFields,
    setOptions,
    discard,
    save,
    resetScope,
  }
}
