import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import {
  DEFAULT_FORMAT_PRIORITY,
  isFiveFieldCronExpression,
  withoutImplicitReadAlongFormatPriority,
  withReadAlongFormatPriority,
} from '@bookorbit/types'
import type { AddedAtSource, CoverAspectRatio, Library, LibraryType, OrganizationMode, PrescanResult } from '@bookorbit/types'
import { coveringFolderPath, normalizeFolderPath } from './folder-paths'

export { DEFAULT_FORMAT_PRIORITY }

export const DEFAULT_METADATA_PRECEDENCE = ['embedded', 'opfFile']

export const METADATA_LABELS: Record<string, string> = {
  embedded: 'Embedded metadata',
  opfFile: 'OPF files',
}

export type LibraryCreatorSectionId = 'details' | 'folders' | 'scanner' | 'metadata' | 'reading' | 'schedule' | 'fileWrite' | 'access'

const FILE_SIZE_MIN_MB = 1
const FILE_SIZE_MAX_MB = 10_000

function blankForm() {
  return {
    type: 'books' as LibraryType,
    name: '',
    icon: null as string | null,
    displayOrder: 0,
    coverAspectRatio: '2/3' as CoverAspectRatio,
    folders: [] as string[],
    localFolders: [] as string[],
    watch: false,
    watchLocalFolders: true,
    autoScanCronExpression: null as string | null,
    metadataPrecedence: [...DEFAULT_METADATA_PRECEDENCE],
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
    fileRenameEnabled: false,
  }
}

export function useLibraryCreator() {
  const form = reactive(blankForm())
  const mode = ref<'create' | 'edit'>('create')
  const editingLibraryId = ref<number | null>(null)
  const loading = ref(false)
  const prescanLoading = ref(false)
  const prescanResult = ref<PrescanResult | null>(null)
  const error = ref<string | null>(null)
  const storedAddedAtSource = ref<AddedAtSource | null>(null)

  const validationErrors = computed<Partial<Record<LibraryCreatorSectionId, string>>>(() => {
    const errors: Partial<Record<LibraryCreatorSectionId, string>> = {}
    if (!form.name.trim()) errors.details = 'Enter a library name.'
    else if (!form.icon?.trim()) errors.details = 'Choose an icon.'
    if (form.folders.length === 0) errors.folders = 'Add at least one folder.'
    else if (form.type === 'podcasts' && form.folders.length !== 1) errors.folders = 'Choose exactly one storage folder for podcasts.'
    else if (form.type === 'podcasts' && overlappingPodcastFolder(form.folders, form.localFolders)) {
      errors.folders = 'Existing podcast folders must sit outside the storage folder.'
    }
    if (form.autoScanCronExpression && !isFiveFieldCronExpression(form.autoScanCronExpression)) {
      errors.schedule = 'Enter a valid 5-field cron expression.'
    }
    if (form.readingThreshold < 0.05 || form.readingThreshold > 5) {
      errors.reading = 'Reading start must be between 0.05% and 5%.'
    } else if (
      !Number.isInteger(form.markAsFinishedPercentComplete) ||
      form.markAsFinishedPercentComplete < 90 ||
      form.markAsFinishedPercentComplete > 100
    ) {
      errors.reading = 'Finished progress must be a whole number between 90% and 100%.'
    }
    const fileSizes = [
      form.fileWriteEpubMaxFileSizeMb,
      form.fileWritePdfMaxFileSizeMb,
      form.fileWriteCbxMaxFileSizeMb,
      form.fileWriteKindleMaxFileSizeMb,
      form.fileWriteAudioMaxFileSizeMb,
    ]
    if (fileSizes.some((value) => !Number.isInteger(value) || value < FILE_SIZE_MIN_MB || value > FILE_SIZE_MAX_MB)) {
      errors.fileWrite = 'File-size limits must be whole numbers from 1 to 10,000 MB.'
    }
    return errors
  })

  function initCreate() {
    storedAddedAtSource.value = null
    Object.assign(form, blankForm())
    mode.value = 'create'
    editingLibraryId.value = null
    prescanResult.value = null
    error.value = null
  }

  function initEdit(library: Library) {
    form.type = library.type
    form.name = library.name
    form.icon = library.icon ?? null
    form.displayOrder = library.displayOrder
    form.coverAspectRatio = library.coverAspectRatio
    form.folders = library.folders.filter((f) => f.role !== 'local').map((f) => f.path)
    form.localFolders = library.folders.filter((f) => f.role === 'local').map((f) => f.path)
    form.watch = library.watch
    form.watchLocalFolders = library.watchLocalFolders ?? true
    form.autoScanCronExpression = library.autoScanCronExpression ?? null
    form.metadataPrecedence = [...library.metadataPrecedence]
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
    form.fileRenameEnabled = library.fileRenameEnabled
    mode.value = 'edit'
    editingLibraryId.value = library.id
    prescanResult.value = null
    error.value = null
  }

  async function runPrescan() {
    if (form.folders.length === 0) return
    prescanLoading.value = true
    prescanResult.value = null
    error.value = null
    try {
      const payload = {
        paths: form.folders,
        ...(editingLibraryId.value === null ? {} : { libraryId: editingLibraryId.value }),
      }
      const res = await api('/api/v1/libraries/prescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        prescanResult.value = await res.json()
      } else {
        error.value = await responseError(res, 'Could not scan the selected folders.')
      }
    } catch {
      error.value = 'Could not connect to the server to scan folders.'
    } finally {
      prescanLoading.value = false
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
      const sharedPayload = {
        type: form.type,
        name: form.name.trim(),
        icon: form.icon!.trim(),
        displayOrder: form.displayOrder,
        coverAspectRatio: form.coverAspectRatio,
        folders: [...new Set(form.folders.map((path) => path.trim()))],
      }
      const payload =
        form.type === 'podcasts'
          ? {
              ...sharedPayload,
              localFolders: [...new Set(form.localFolders.map((path) => path.trim()))],
              watchLocalFolders: form.watchLocalFolders,
            }
          : {
              ...form,
              ...sharedPayload,
              formatPriority: withoutImplicitReadAlongFormatPriority(form.formatPriority),
              localFolders: undefined,
              watchLocalFolders: undefined,
            }
      let res: Response
      if (mode.value === 'create') {
        res = await api('/api/v1/libraries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        const { type: _type, ...updatePayload } = payload
        res = await api(`/api/v1/libraries/${editingLibraryId.value}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        })
      }
      if (!res.ok) {
        error.value = await responseError(res, 'Failed to save library.')
        return null
      }
      return await res.json()
    } catch {
      error.value = 'Could not connect to the server. Check your connection and try again.'
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    form,
    storedAddedAtSource,
    mode,
    editingLibraryId,
    loading,
    prescanLoading,
    prescanResult,
    error,
    validationErrors,
    initCreate,
    initEdit,
    runPrescan,
    save,
  }
}

/**
 * Whether a storage folder and an existing-podcasts folder overlap. The server refuses the same
 * pairing; catching it here means the wizard says so before the save round-trip.
 */
function overlappingPodcastFolder(folders: string[], localFolders: string[]): boolean {
  const storage = folders.map(normalizeFolderPath)
  return localFolders.some((candidate) => {
    const local = normalizeFolderPath(candidate)
    return storage.some((path) => path === local || coveringFolderPath(local, [path]) !== null || coveringFolderPath(path, [local]) !== null)
  })
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null)
  const message = body?.message
  if (Array.isArray(message)) return message.find((entry): entry is string => typeof entry === 'string') ?? fallback
  return typeof message === 'string' && message.trim() ? message : fallback
}
