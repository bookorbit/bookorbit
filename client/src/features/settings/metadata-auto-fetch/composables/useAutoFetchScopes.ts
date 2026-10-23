import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  BookMetadataFetchConditions,
  BookMetadataFetchConfig,
  BookMetadataFetchConfigOverride,
  BookMetadataFetchLibraryConfig,
  BookMetadataFetchLibraryConfigEntry,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { GLOBAL_SCOPE, type FieldRuleScope } from '@/features/settings/metadata-preferences/composables/useFieldRuleScopes'
import {
  clearOverrideKey,
  globalChangeCount,
  mergeConfig,
  overriddenKeys,
  overrideChangeCount,
  overrideRequestBody,
  setOverrideCondition,
  setOverrideOnImport,
  withOnImport,
  type ConditionKey,
  type OnImportChoice,
  type OverrideKey,
} from '../lib/auto-fetch-rules'

export type AutoFetchScopeId = typeof GLOBAL_SCOPE | number

export interface AutoFetchLibraryScope {
  id: number
  name: string
  saved: BookMetadataFetchConfigOverride
  draft: BookMetadataFetchConfigOverride
  lastRunAt: string | null
  lastQueuedCount: number | null
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Drafts for the global rule and every library's own rule, saved one scope at a time like Field Rules. */
export function useAutoFetchScopes() {
  const { t } = useI18n()
  const loading = ref(true)
  const loadFailed = ref(false)
  const saving = ref(false)
  const savedGlobal = ref<BookMetadataFetchConfig | null>(null)
  const draftGlobal = ref<BookMetadataFetchConfig | null>(null)
  const libraries = ref<AutoFetchLibraryScope[]>([])
  const activeId = ref<AutoFetchScopeId>(GLOBAL_SCOPE)

  async function load(): Promise<void> {
    loading.value = true
    loadFailed.value = false
    try {
      const [configRes, librariesRes] = await Promise.all([
        api('/api/v1/book-metadata-fetch/config'),
        api('/api/v1/book-metadata-fetch/config/libraries'),
      ])
      if (!configRes.ok || !librariesRes.ok) throw new Error('load failed')
      const config: BookMetadataFetchConfig = await configRes.json()
      const entries: BookMetadataFetchLibraryConfigEntry[] = await librariesRes.json()
      savedGlobal.value = config
      draftGlobal.value = clone(config)
      libraries.value = entries.map((entry) => ({
        id: entry.libraryId,
        name: entry.libraryName,
        saved: entry.override,
        draft: clone(entry.override),
        lastRunAt: entry.lastRunAt,
        lastQueuedCount: entry.lastQueuedCount,
      }))
      if (activeId.value !== GLOBAL_SCOPE && !libraries.value.some((library) => library.id === activeId.value)) activeId.value = GLOBAL_SCOPE
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  /** Picks up the last-run lines after a run without touching anyone's drafts. */
  async function refreshRuns(): Promise<void> {
    const res = await api('/api/v1/book-metadata-fetch/config/libraries')
    if (!res.ok) return
    const entries: BookMetadataFetchLibraryConfigEntry[] = await res.json()
    for (const entry of entries) {
      const library = libraries.value.find((item) => item.id === entry.libraryId)
      if (!library) continue
      library.lastRunAt = entry.lastRunAt
      library.lastQueuedCount = entry.lastQueuedCount
    }
  }

  const activeLibrary = computed(() =>
    activeId.value === GLOBAL_SCOPE ? null : (libraries.value.find((library) => library.id === activeId.value) ?? null),
  )
  const activeConfig = computed<BookMetadataFetchConfig | null>(() => {
    if (!draftGlobal.value) return null
    return activeLibrary.value ? mergeConfig(draftGlobal.value, activeLibrary.value.draft) : draftGlobal.value
  })
  const followerIds = computed(() => libraries.value.filter((library) => !library.draft).map((library) => library.id))
  const ownRuleLibraries = computed(() => libraries.value.filter((library) => library.draft))
  /** The libraries the active scope's counts and preview cover. */
  const activeLibraryIds = computed(() => (activeLibrary.value ? [activeLibrary.value.id] : followerIds.value))
  const activeOwnKeys = computed<OverrideKey[]>(() => (activeLibrary.value ? overriddenKeys(activeLibrary.value.draft) : []))

  const globalUnsaved = computed(() => (savedGlobal.value && draftGlobal.value ? globalChangeCount(savedGlobal.value, draftGlobal.value) : 0))
  function libraryUnsaved(library: AutoFetchLibraryScope): number {
    return overrideChangeCount(library.saved, library.draft)
  }
  const activeUnsaved = computed(() => (activeLibrary.value ? libraryUnsaved(activeLibrary.value) : globalUnsaved.value))
  const anyUnsaved = computed(() => globalUnsaved.value > 0 || libraries.value.some((library) => libraryUnsaved(library) > 0))
  /** A library's rule is built on the global one, so either having unsaved edits makes a run disagree with the page. */
  const runBlocked = computed(() => (activeLibrary.value ? globalUnsaved.value > 0 || libraryUnsaved(activeLibrary.value) > 0 : anyUnsaved.value))

  const scopes = computed<FieldRuleScope[]>(() => [
    {
      id: GLOBAL_SCOPE,
      name: t('settings.metadata.fieldRules.scope.global'),
      isGlobal: true,
      overrideCount: 0,
      unsavedCount: globalUnsaved.value,
      loaded: true,
    },
    ...libraries.value.map((library) => ({
      id: library.id,
      name: library.name,
      isGlobal: false,
      overrideCount: overriddenKeys(library.draft).length,
      unsavedCount: libraryUnsaved(library),
      loaded: true,
    })),
  ])
  const activeName = computed(() => activeLibrary.value?.name ?? t('settings.metadata.fieldRules.scope.global'))

  function select(id: AutoFetchScopeId): void {
    activeId.value = id
  }

  function setCondition<K extends ConditionKey>(key: K, value: BookMetadataFetchConditions[K]): void {
    if (!draftGlobal.value) return
    const library = activeLibrary.value
    if (library) library.draft = setOverrideCondition(draftGlobal.value, library.draft, key, value)
    else draftGlobal.value = { ...draftGlobal.value, conditions: { ...draftGlobal.value.conditions, [key]: clone(value) } }
  }

  function setOnImport(choice: OnImportChoice): void {
    if (!draftGlobal.value) return
    const library = activeLibrary.value
    if (library) library.draft = setOverrideOnImport(library.draft, choice)
    else draftGlobal.value = withOnImport(draftGlobal.value, choice === 'on')
  }

  function followGlobal(key: OverrideKey | 'all'): void {
    const library = activeLibrary.value
    if (library) library.draft = clearOverrideKey(library.draft, key)
  }

  function discard(): void {
    const library = activeLibrary.value
    if (library) library.draft = clone(library.saved)
    else if (savedGlobal.value) draftGlobal.value = clone(savedGlobal.value)
  }

  /** Saves the active scope only. Returns whether the server took it. */
  async function save(): Promise<boolean> {
    if (saving.value || !draftGlobal.value) return false
    saving.value = true
    try {
      const library = activeLibrary.value
      if (library) {
        const res = await api(`/api/v1/book-metadata-fetch/config/libraries/${library.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(overrideRequestBody(library.draft)),
        })
        if (!res.ok) return false
        const data: BookMetadataFetchLibraryConfig = await res.json()
        library.saved = data.override
        library.draft = clone(data.override)
        return true
      }
      const res = await api('/api/v1/book-metadata-fetch/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftGlobal.value),
      })
      if (!res.ok) return false
      const data: BookMetadataFetchConfig = await res.json()
      savedGlobal.value = data
      draftGlobal.value = clone(data)
      return true
    } catch {
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    loading,
    loadFailed,
    saving,
    savedGlobal,
    draftGlobal,
    libraries,
    activeId,
    activeLibrary,
    activeConfig,
    activeLibraryIds,
    activeOwnKeys,
    activeUnsaved,
    activeName,
    followerIds,
    ownRuleLibraries,
    anyUnsaved,
    runBlocked,
    scopes,
    load,
    refreshRuns,
    select,
    setCondition,
    setOnImport,
    followGlobal,
    discard,
    save,
  }
}
