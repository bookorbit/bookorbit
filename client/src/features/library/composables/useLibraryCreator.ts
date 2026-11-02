import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import {
  DEFAULT_FORMAT_PRIORITY,
  isFiveFieldCronExpression,
  resolveRegexMetadataConfig,
  withoutImplicitReadAlongFormatPriority,
  withReadAlongFormatPriority,
} from '@bookorbit/types'
import type { AddedAtSource, CoverAspectRatio, Library, LibraryStats, OrganizationMode, PrescanResult } from '@bookorbit/types'
import { i18n } from '@/i18n'

export { DEFAULT_FORMAT_PRIORITY }

export const DEFAULT_METADATA_PRECEDENCE = ['embedded', 'opfFile', 'regex']

export const METADATA_LABELS: Record<string, string> = {
  embedded: 'Embedded metadata',
  opfFile: 'OPF files',
  regex: 'Regex metadata',
}

export type LibraryCreatorSectionId = 'details' | 'folders' | 'scanner' | 'metadata' | 'reading' | 'schedule' | 'fileWrite' | 'access'

/** The result of checking one folder: whether the server can read it, and what it would import. */
export type FolderCheck =
  { state: 'checking' } | { state: 'checked'; accessible: boolean; fileCount: number; overlapLibrary?: string } | { state: 'failed' }

const FILE_SIZE_MIN_MB = 1
const FILE_SIZE_MAX_MB = 10_000

function blankForm() {
  return {
    name: '',
    icon: null as string | null,
    displayOrder: 0,
    coverAspectRatio: '2/3' as CoverAspectRatio,
    folders: [] as string[],
    watch: false,
    autoScanCronExpression: null as string | null,
    metadataPrecedence: [...DEFAULT_METADATA_PRECEDENCE],
    regexMetadata: null as Library['regexMetadata'],
    formatPriority: withReadAlongFormatPriority(DEFAULT_FORMAT_PRIORITY),
    allowedFormats: [] as string[],
    organizationMode: 'book_per_folder' as OrganizationMode,
    addedAtSource: 'imported' as AddedAtSource,
    excludePatterns: [] as string[],
    readingThreshold: 0.25,
    markAsFinishedPercentComplete: 98,
    fileWriteEnabled: false,
    fileWriteWriteCover: true,
    fileWriteEpubEnabled: true,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: true,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: true,
    fileWriteAudioMaxFileSizeMb: 500,
    fileWriteAllFiles: false,
    fileWriteReadAlongEnabled: false,
    fileWriteReadAlongMaxFileSizeMb: 1000,
    fileRenameEnabled: false,
  }
}

export function useLibraryCreator() {
  const t = (key: string) => i18n.global.t(key)
  const form = reactive(blankForm())
  const mode = ref<'create' | 'edit'>('create')
  const editingLibraryId = ref<number | null>(null)
  const loading = ref(false)
  const folderChecks = ref<Record<string, FolderCheck>>({})
  const stats = ref<LibraryStats | null>(null)
  const error = ref<string | null>(null)
  const storedAddedAtSource = ref<AddedAtSource | null>(null)
  /** The path rules the server has, which is what applying them to existing books uses. */
  const storedRegexMetadata = ref<Library['regexMetadata']>(null)
  const latestCheck = new Map<string, number>()
  let checkSequence = 0

  const validationErrors = computed<Partial<Record<LibraryCreatorSectionId, string>>>(() => {
    const errors: Partial<Record<LibraryCreatorSectionId, string>> = {}
    if (!form.name.trim()) errors.details = t('library.creator.errors.nameRequired')
    else if (!form.icon?.trim()) errors.details = t('library.creator.errors.iconRequired')
    if (form.folders.length === 0) errors.folders = t('library.creator.errors.folderRequired')
    if (form.autoScanCronExpression && !isFiveFieldCronExpression(form.autoScanCronExpression)) {
      errors.schedule = t('library.creator.errors.cronInvalid')
    }
    if (form.readingThreshold < 0.05 || form.readingThreshold > 5) {
      errors.reading = t('library.creator.errors.readingStartRange')
    } else if (
      !Number.isFinite(form.markAsFinishedPercentComplete) ||
      form.markAsFinishedPercentComplete < 90 ||
      form.markAsFinishedPercentComplete > 100
    ) {
      errors.reading = t('library.creator.reading.markAsFinished.invalidThreshold')
    }
    const fileSizes = [
      form.fileWriteEpubMaxFileSizeMb,
      form.fileWritePdfMaxFileSizeMb,
      form.fileWriteCbxMaxFileSizeMb,
      form.fileWriteKindleMaxFileSizeMb,
      form.fileWriteAudioMaxFileSizeMb,
      form.fileWriteReadAlongMaxFileSizeMb,
    ]
    if (fileSizes.some((value) => !Number.isInteger(value) || value < FILE_SIZE_MIN_MB || value > FILE_SIZE_MAX_MB)) {
      errors.fileWrite = t('library.creator.errors.fileSizeRange')
    }
    return errors
  })

  function initCreate() {
    storedAddedAtSource.value = null
    storedRegexMetadata.value = null
    Object.assign(form, blankForm())
    mode.value = 'create'
    editingLibraryId.value = null
    folderChecks.value = {}
    stats.value = null
    error.value = null
  }

  function initEdit(library: Library) {
    applyLibrary(library)
    mode.value = 'edit'
    editingLibraryId.value = library.id
    folderChecks.value = {}
    error.value = null
  }

  /**
   * Seeds a new library from an existing one's settings. Folders and access belong to the original, so
   * they start empty, and nothing reaches the server until the new library is created.
   */
  function initFromTemplate(template: Library, name: string) {
    initCreate()
    applyLibrary(template)
    form.name = name
    form.displayOrder = blankForm().displayOrder
    form.folders = []
    storedAddedAtSource.value = null
    storedRegexMetadata.value = null
  }

  function applyLibrary(library: Library) {
    form.name = library.name
    form.icon = library.icon ?? null
    form.displayOrder = library.displayOrder
    form.coverAspectRatio = library.coverAspectRatio
    form.folders = library.folders.map((f) => f.path)
    form.watch = library.watch
    form.autoScanCronExpression = library.autoScanCronExpression ?? null
    form.metadataPrecedence = [...library.metadataPrecedence]
    // A preset is shown with its current rules, which are what the server runs for it.
    const regexMetadata = resolveRegexMetadataConfig(library.regexMetadata)
    form.regexMetadata = regexMetadata
      ? { ...(regexMetadata.preset ? { preset: regexMetadata.preset } : {}), rules: regexMetadata.rules.map((rule) => ({ ...rule })) }
      : null
    storedRegexMetadata.value = regexMetadata
    const missing = DEFAULT_FORMAT_PRIORITY.filter((f) => !library.formatPriority.includes(f))
    form.formatPriority = withReadAlongFormatPriority([...library.formatPriority, ...missing])
    form.allowedFormats = [...library.allowedFormats]
    form.organizationMode = library.organizationMode
    form.addedAtSource = library.addedAtSource
    storedAddedAtSource.value = library.addedAtSource
    form.excludePatterns = [...library.excludePatterns]
    form.readingThreshold = library.readingThreshold
    form.markAsFinishedPercentComplete = library.markAsFinishedPercentComplete
    form.fileWriteEnabled = library.fileWriteEnabled
    form.fileWriteWriteCover = library.fileWriteWriteCover
    form.fileWriteEpubEnabled = library.fileWriteEpubEnabled
    form.fileWriteEpubMaxFileSizeMb = library.fileWriteEpubMaxFileSizeMb
    form.fileWriteFb2Enabled = library.fileWriteFb2Enabled
    form.fileWriteFb2MaxFileSizeMb = library.fileWriteFb2MaxFileSizeMb
    form.fileWritePdfEnabled = library.fileWritePdfEnabled
    form.fileWritePdfMaxFileSizeMb = library.fileWritePdfMaxFileSizeMb
    form.fileWriteCbxEnabled = library.fileWriteCbxEnabled
    form.fileWriteCbxMaxFileSizeMb = library.fileWriteCbxMaxFileSizeMb
    form.fileWriteKindleEnabled = library.fileWriteKindleEnabled
    form.fileWriteKindleMaxFileSizeMb = library.fileWriteKindleMaxFileSizeMb
    form.fileWriteAudioEnabled = library.fileWriteAudioEnabled
    form.fileWriteAudioMaxFileSizeMb = library.fileWriteAudioMaxFileSizeMb
    form.fileWriteAllFiles = library.fileWriteAllFiles
    form.fileWriteReadAlongEnabled = library.fileWriteReadAlongEnabled
    form.fileWriteReadAlongMaxFileSizeMb = library.fileWriteReadAlongMaxFileSizeMb
    form.fileRenameEnabled = library.fileRenameEnabled
  }

  /**
   * Checks folders one request at a time per call, keyed by the requested path because the server
   * answers with the resolved path. Only the folders asked about are counted: recounting a large
   * existing folder every time another is added would walk tens of thousands of files for nothing.
   */
  async function checkFolders(paths: string[] = form.folders): Promise<void> {
    const targets = [...new Set(paths)].filter((path) => path.trim())
    if (targets.length === 0) return
    const sequence = ++checkSequence
    const pending = { ...folderChecks.value }
    for (const path of targets) {
      latestCheck.set(path, sequence)
      pending[path] = { state: 'checking' }
    }
    folderChecks.value = pending

    let results: PrescanResult['paths'] | null = null
    try {
      const res = await api('/api/v1/libraries/prescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: targets, ...(editingLibraryId.value === null ? {} : { libraryId: editingLibraryId.value }) }),
      })
      if (res.ok) results = ((await res.json()) as PrescanResult).paths
    } catch {
      results = null
    }

    const next = { ...folderChecks.value }
    targets.forEach((path, index) => {
      if (latestCheck.get(path) !== sequence) return
      const result = results?.[index]
      next[path] = result
        ? { state: 'checked', accessible: result.accessible, fileCount: result.fileCount, overlapLibrary: result.overlapLibrary }
        : { state: 'failed' }
    })
    folderChecks.value = next
  }

  async function loadStats(): Promise<void> {
    if (editingLibraryId.value === null) return
    try {
      const res = await api(`/api/v1/libraries/${editingLibraryId.value}/stats`)
      if (res.ok) stats.value = (await res.json()) as LibraryStats
    } catch {
      stats.value = null
    }
  }

  async function save(): Promise<Library | null> {
    const firstValidationError = Object.values(validationErrors.value)[0]
    if (firstValidationError) {
      error.value = firstValidationError
      return null
    }
    error.value = null
    loading.value = true
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        icon: form.icon!.trim(),
        folders: [...new Set(form.folders.map((path) => path.trim()))],
        formatPriority: withoutImplicitReadAlongFormatPriority(form.formatPriority),
      }
      const res =
        mode.value === 'create'
          ? await api('/api/v1/libraries', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await api(`/api/v1/libraries/${editingLibraryId.value}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
      if (!res.ok) {
        error.value = await responseError(res, t('library.creator.errors.saveFailed'))
        return null
      }
      return await res.json()
    } catch {
      error.value = t('library.creator.errors.connection')
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    form,
    storedAddedAtSource,
    storedRegexMetadata,
    mode,
    editingLibraryId,
    loading,
    folderChecks,
    stats,
    error,
    validationErrors,
    initCreate,
    initEdit,
    initFromTemplate,
    checkFolders,
    loadStats,
    save,
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null)
  const message = body?.message
  if (Array.isArray(message)) return message.find((entry): entry is string => typeof entry === 'string') ?? fallback
  return typeof message === 'string' && message.trim() ? message : fallback
}
