import { computed, reactive, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { BOOK_REQUEST_MEDIA_KINDS, INDEXER_ADAPTER_TYPES, pickUnusedIndexerColor } from '@bookorbit/types'
import { useSettingsDraft } from './useSettingsDraft'
import type {
  BookRequestMediaKind,
  CreateIndexerPayload,
  IndexerAdapterDescriptor,
  IndexerColor,
  IndexerItem,
  IndexerSettingsField,
  NetworkProfile,
  UpdateIndexerPayload,
} from '@bookorbit/types'

import type { IndexerFailure } from '@/features/book-requests/composables/useIndexers'

/** Category numbers are a list, so they are edited as one rather than as punctuation in a box. */
export type CategoryDraft = Record<BookRequestMediaKind, string[]>

export interface IndexerDraft {
  id: number | null
  name: string
  /** Null is a real choice here, not an unset field: it is the neutral chip the picker falls back to. */
  color: IndexerColor | null
  adapterType: string
  baseUrl: string
  credential: string
  /** Only sent when the operator actually typed one, so editing does not wipe a stored secret. */
  credentialTouched: boolean
  credentialCleared: boolean
  enabled: boolean
  allowPrivateAddress: boolean
  categories: CategoryDraft
  /**
   * Held as what the source *is* searched for, because that is what the form shows and what an
   * operator reasons about. Inverted into the stored opt-out on the way to the payload.
   */
  searchedMediaKinds: BookRequestMediaKind[]
  /** Positive here too, for the same reason: the form asks whether the source is given the ISBN. */
  searchByIsbn: boolean
  /** Keyed by the adapter's own declared field names, so a plugin's fields round-trip unchanged. */
  settings: Record<string, unknown>
  resolvers: string[]
  proxyUrl: string
}

/** The fields a save can be rejected for, so the diagnosis lands on the box that caused it. */
export type FieldKey = 'name' | 'baseUrl' | 'credential'

/**
 * Server codes carry the copy; the English `message` is a last resort for anything unmapped, which
 * beats swallowing a diagnosis the operator needs to act on.
 */
const SAVE_ERROR_KEYS: Record<string, string> = {
  INDEXER_NAME_TAKEN: 'settings.system.requests.indexers.errors.nameTaken',
  INDEXER_URL_UNSAFE: 'settings.system.requests.indexers.errors.urlUnsafe',
  INDEXER_URL_PRIVATE: 'settings.system.requests.indexers.errors.urlPrivate',
  INDEXER_CREDENTIAL_REQUIRED: 'settings.system.requests.indexers.errors.credentialRequired',
  INDEXER_SETTINGS_INVALID: 'settings.system.requests.indexers.errors.invalidSettings',
  REQUEST_ENCRYPTION_KEY_MISSING: 'settings.system.requests.errors.encryptionKeyMissing',
  REQUEST_ENCRYPTION_KEY_CHANGED: 'settings.system.requests.errors.encryptionKeyChanged',
}

/** Which box a rejection belongs under. Anything unmapped stays a toast, rather than nowhere. */
const SAVE_ERROR_FIELDS: Record<string, FieldKey> = {
  INDEXER_NAME_TAKEN: 'name',
  INDEXER_URL_UNSAFE: 'baseUrl',
  INDEXER_URL_PRIVATE: 'baseUrl',
  INDEXER_CREDENTIAL_REQUIRED: 'credential',
  REQUEST_ENCRYPTION_KEY_MISSING: 'credential',
  REQUEST_ENCRYPTION_KEY_CHANGED: 'credential',
}

/** Compiled in rather than loaded from disk, which is what separates a source from a plugin one. */
export function isBuiltInAdapter(type: string): boolean {
  return (INDEXER_ADAPTER_TYPES as readonly string[]).includes(type)
}

export interface IndexerDraftOptions {
  indexers: Ref<IndexerItem[]>
  adapterFor: (type: string) => IndexerAdapterDescriptor | undefined
  /** The adapter's display name, which prefers a translated key over untranslated plugin English. */
  adapterLabel: (adapter: IndexerAdapterDescriptor) => string
  save: (id: number | null, payload: CreateIndexerPayload | UpdateIndexerPayload) => Promise<IndexerFailure | null>
}

/**
 * The indexer editor: one draft row, the boxes that make it up, and what a rejected save says.
 *
 * The draft is held apart from the stored row on purpose. An adapter loaded at runtime names its
 * own settings fields, so the form is shaped by the descriptor rather than by a fixed schema, and
 * a value the running build no longer declares has to survive being opened without being sent back.
 */
export function useIndexerDraft(options: IndexerDraftOptions) {
  const { t } = useI18n()
  const { indexers, adapterFor, adapterLabel, save } = options

  const { draft, open: editorOpen, isDirty, start, close } = useSettingsDraft<IndexerDraft>()
  const credentialVisible = ref(false)
  const fieldErrors = reactive<Partial<Record<FieldKey, string>>>({})
  const currentAdapter = computed(() => (draft.value ? adapterFor(draft.value.adapterType) : undefined))
  const editingIndexer = computed(() => (draft.value?.id === null ? null : (indexers.value.find((row) => row.id === draft.value?.id) ?? null)))

  const sheetTitle = computed(() => {
    if (draft.value === null) return ''
    return draft.value.id === null ? t('settings.system.requests.indexers.add') : draft.value.name || t('settings.system.requests.indexers.edit')
  })

  /**
   * Nothing to scope when the adapter carries a single medium: the block would be one live switch
   * that turns the source off entirely, next to two rows saying the source does not carry them.
   * That is the Enabled switch with extra steps, so the whole thing is left out.
   */
  const canScopeMediaKinds = computed(() => (currentAdapter.value?.mediaKinds.length ?? BOOK_REQUEST_MEDIA_KINDS.length) > 1)

  function describeFailure(failure: IndexerFailure): string {
    const key = failure.errorCode ? SAVE_ERROR_KEYS[failure.errorCode] : undefined
    if (key) return t(key)
    return failure.message ?? t('settings.system.requests.indexers.errors.saveFailed')
  }

  function toCategoryDraft(categories: Record<BookRequestMediaKind, number[]>): CategoryDraft {
    return {
      ebook: categories.ebook.map(String),
      audiobook: categories.audiobook.map(String),
      comic: categories.comic.map(String),
    }
  }

  /** An adapter's declared defaults, so a fresh row starts where the adapter says it should. */
  function defaultSettings(adapter: IndexerAdapterDescriptor | undefined): Record<string, unknown> {
    const settings: Record<string, unknown> = {}
    for (const field of adapter?.settingsFields ?? []) {
      if (field.default !== undefined) settings[field.key] = field.default
    }
    return settings
  }

  function emptyDraft(adapterType: string): IndexerDraft {
    const adapter = adapterFor(adapterType)
    return {
      id: null,
      name: '',
      color: pickUnusedIndexerColor(indexers.value.map((indexer) => indexer.color)),
      adapterType,
      baseUrl: adapter?.defaultBaseUrl ?? '',
      credential: '',
      credentialTouched: false,
      credentialCleared: false,
      enabled: true,
      allowPrivateAddress: false,
      categories: toCategoryDraft(adapter?.defaultCategories ?? { ebook: [], audiobook: [], comic: [] }),
      searchedMediaKinds: [...BOOK_REQUEST_MEDIA_KINDS],
      searchByIsbn: true,
      settings: defaultSettings(adapter),
      resolvers: [],
      proxyUrl: '',
    }
  }

  function openDraft(next: IndexerDraft) {
    start(next)
    credentialVisible.value = false
    clearFieldErrors()
  }

  /** Torznab is the only built-in, so adding an indexer is adding a Torznab one. Nothing to pick. */
  function startCreate() {
    openDraft(emptyDraft('torznab'))
  }

  /**
   * Straight to the form for one adapter, skipping the picker, because the type is already settled.
   * Installing a plugin only teaches the server a new type; until an indexer uses that type nothing
   * searches, so the step after installing is this one and it should not have to be gone looking for.
   */
  function startCreateFor(type: string) {
    const adapter = adapterFor(type)
    openDraft({ ...emptyDraft(type), name: adapter ? adapterLabel(adapter) : '' })
  }

  function startEdit(indexer: IndexerItem) {
    const adapter = adapterFor(indexer.adapterType)
    openDraft({
      id: indexer.id,
      name: indexer.name,
      color: indexer.color,
      adapterType: indexer.adapterType,
      baseUrl: indexer.baseUrl,
      credential: '',
      credentialTouched: false,
      credentialCleared: false,
      enabled: indexer.enabled,
      allowPrivateAddress: indexer.allowPrivateAddress,
      categories: toCategoryDraft(indexer.categories),
      searchedMediaKinds: BOOK_REQUEST_MEDIA_KINDS.filter((mediaKind) => !indexer.disabledMediaKinds.includes(mediaKind)),
      searchByIsbn: !indexer.isbnSearchDisabled,
      settings: normalizeDeclaredSettings(adapter, { ...defaultSettings(adapter), ...indexer.settings }),
      resolvers: [...(indexer.networkProfile?.resolvers ?? [])],
      proxyUrl: indexer.networkProfile?.proxyUrl ?? '',
    })
  }

  function cancelEdit() {
    close()
    clearFieldErrors()
  }

  function clearFieldErrors() {
    for (const key of Object.keys(fieldErrors) as FieldKey[]) delete fieldErrors[key]
  }

  function clearFieldError(field: FieldKey) {
    delete fieldErrors[field]
  }

  function handleNameInput() {
    clearFieldError('name')
  }

  function handleBaseUrlInput() {
    clearFieldError('baseUrl')
  }

  function markCredentialTouched() {
    if (!draft.value) return
    draft.value.credentialTouched = draft.value.credential.length > 0
    draft.value.credentialCleared = false
    clearFieldError('credential')
  }

  const canClearCredential = computed(() => editingIndexer.value?.hasCredential === true && currentAdapter.value?.requiresCredential !== true)

  function toggleClearCredential() {
    const current = draft.value
    if (!current) return
    current.credentialCleared = !current.credentialCleared
    if (current.credentialCleared) {
      current.credential = ''
      current.credentialTouched = false
    }
    clearFieldError('credential')
  }

  function toggleCredentialVisible() {
    credentialVisible.value = !credentialVisible.value
  }

  function setSetting(key: string, value: unknown) {
    if (draft.value) draft.value.settings[key] = value
  }

  /**
   * A cleared number box is not a zero. `Number('')` is 0, so emptying a plugin's "minimum
   * seeders" used to store a floor of zero rather than removing the floor, which the server then
   * kept because zero is a perfectly valid value for the field.
   */
  function handleSettingInput(field: IndexerSettingsField, event: Event) {
    const raw = (event.target as HTMLInputElement).value
    if (field.type !== 'number') {
      setSetting(field.key, raw)
      return
    }
    setSetting(field.key, raw.trim() === '' ? undefined : Number(raw))
  }

  /** A list-shaped adapter setting is stored as the comma-separated string the adapter expects. */
  function settingList(field: IndexerSettingsField): string[] {
    const raw = draft.value?.settings[field.key]
    if (typeof raw !== 'string') return []
    return normalizeSettingEntries(field, raw)
  }

  function setSettingList(field: IndexerSettingsField, values: string[]) {
    setSetting(field.key, values.join(','))
  }

  /** Old plugin values are repaired as the editor opens, before they can return to the server. */
  function normalizeDeclaredSettings(adapter: IndexerAdapterDescriptor | undefined, settings: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...settings }
    for (const field of adapter?.settingsFields ?? []) {
      if (field.format !== 'list') continue
      const raw = normalized[field.key]
      const values = typeof raw === 'string' ? normalizeSettingEntries(field, raw) : []
      const defaults = typeof field.default === 'string' ? normalizeSettingEntries(field, field.default) : []
      normalized[field.key] = (values.length >= (field.minItems ?? 0) ? values : defaults).join(',')
    }
    return normalized
  }

  function normalizeSettingEntries(field: IndexerSettingsField, raw: string): string[] {
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (!field.options) return [...new Set(entries)]

    const canonical = new Map(field.options.map((option) => [option.toLowerCase(), option]))
    return [...new Set(entries.map((entry) => canonical.get(entry.toLowerCase())).filter((entry): entry is string => entry !== undefined))]
  }

  function isSettingOptionSelected(field: IndexerSettingsField, option: string): boolean {
    return settingList(field).includes(option)
  }

  function isSettingOptionLocked(field: IndexerSettingsField, option: string): boolean {
    const values = settingList(field)
    return values.includes(option) && values.length <= (field.minItems ?? 0)
  }

  function toggleSettingOption(field: IndexerSettingsField, option: string): void {
    const values = settingList(field)
    if (values.includes(option)) {
      if (values.length <= (field.minItems ?? 0)) return
      setSettingList(
        field,
        values.filter((value) => value !== option),
      )
      return
    }
    setSettingList(field, [...values, option])
  }

  function canRestoreSettingDefault(field: IndexerSettingsField): boolean {
    if (typeof field.default !== 'string') return false
    return settingList(field).join(',') !== normalizeSettingEntries(field, field.default).join(',')
  }

  function restoreSettingDefault(field: IndexerSettingsField): void {
    if (typeof field.default === 'string') setSettingList(field, normalizeSettingEntries(field, field.default))
  }

  /** Anything that is not a whole category number is refused as it is typed, not on save. */
  function normalizeCategory(raw: string): string | null {
    return /^\d+$/.test(raw) ? String(Number(raw)) : null
  }

  function parseCategories(values: string[]): number[] {
    return values.map(Number).filter((entry) => Number.isInteger(entry) && entry >= 0)
  }

  /**
   * What the adapter itself can answer for. A medium it does not carry is shown off and inert rather
   * than hidden, because "this source has no ebooks" is the fact the operator needs; a missing row
   * reads as a form that forgot something.
   */
  function adapterCarries(mediaKind: BookRequestMediaKind): boolean {
    const adapter = currentAdapter.value
    return !adapter || adapter.mediaKinds.includes(mediaKind)
  }

  function isMediaKindSearched(mediaKind: BookRequestMediaKind): boolean {
    return adapterCarries(mediaKind) && (draft.value?.searchedMediaKinds.includes(mediaKind) ?? false)
  }

  function toggleMediaKind(mediaKind: BookRequestMediaKind): void {
    const current = draft.value
    if (!current || !adapterCarries(mediaKind)) return
    current.searchedMediaKinds = current.searchedMediaKinds.includes(mediaKind)
      ? current.searchedMediaKinds.filter((kind) => kind !== mediaKind)
      : [...current.searchedMediaKinds, mediaKind]
  }

  function toPayload(current: IndexerDraft): CreateIndexerPayload {
    return {
      name: current.name.trim(),
      adapterType: current.adapterType,
      baseUrl: current.baseUrl.trim(),
      color: current.color,
      ...(current.credentialCleared ? { credential: '' } : current.credentialTouched ? { credential: current.credential } : {}),
      enabled: current.enabled,
      allowPrivateAddress: current.allowPrivateAddress,
      categories: {
        ebook: parseCategories(current.categories.ebook),
        audiobook: parseCategories(current.categories.audiobook),
        comic: parseCategories(current.categories.comic),
      },
      disabledMediaKinds: BOOK_REQUEST_MEDIA_KINDS.filter((mediaKind) => !current.searchedMediaKinds.includes(mediaKind)),
      isbnSearchDisabled: !current.searchByIsbn,
      settings: current.settings,
      networkProfile: toNetworkProfile(current),
    }
  }

  /** Null rather than an empty object, so "nothing configured" stays the default path. */
  function toNetworkProfile(current: IndexerDraft): NetworkProfile | null {
    const resolvers = current.resolvers.map((entry) => entry.trim()).filter(Boolean)
    const proxyUrl = current.proxyUrl.trim()
    if (resolvers.length === 0 && !proxyUrl) return null
    return { ...(resolvers.length > 0 ? { resolvers } : {}), ...(proxyUrl ? { proxyUrl } : {}) }
  }

  async function handleSave() {
    const current = draft.value
    if (!current) return

    clearFieldErrors()
    if (!current.name.trim()) fieldErrors.name = t('settings.system.requests.indexers.errors.nameRequired')
    if (!current.baseUrl.trim()) fieldErrors.baseUrl = t('settings.system.requests.indexers.errors.urlRequired')
    if (Object.keys(fieldErrors).length > 0) return

    const failure = await save(current.id, toPayload(current))
    if (failure) {
      const field = failure.errorCode ? SAVE_ERROR_FIELDS[failure.errorCode] : undefined
      if (field) fieldErrors[field] = describeFailure(failure)
      else toast.error(describeFailure(failure))
      return
    }
    toast.success(t('settings.system.requests.indexers.saved'))
    cancelEdit()
  }

  return {
    draft,
    editorOpen,
    credentialVisible,
    fieldErrors,
    isDirty,
    currentAdapter,
    editingIndexer,
    sheetTitle,
    canScopeMediaKinds,
    describeFailure,
    startCreate,
    startCreateFor,
    startEdit,
    cancelEdit,
    handleNameInput,
    handleBaseUrlInput,
    markCredentialTouched,
    canClearCredential,
    toggleClearCredential,
    toggleCredentialVisible,
    setSetting,
    handleSettingInput,
    settingList,
    setSettingList,
    isSettingOptionSelected,
    isSettingOptionLocked,
    toggleSettingOption,
    canRestoreSettingDefault,
    restoreSettingDefault,
    normalizeCategory,
    adapterCarries,
    isMediaKindSearched,
    toggleMediaKind,
    handleSave,
  }
}
