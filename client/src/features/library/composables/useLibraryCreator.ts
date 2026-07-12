import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { DEFAULT_FORMAT_PRIORITY, FORMAT_LABELS } from '@bookorbit/types'
import type { CoverAspectRatio, Library, OrganizationMode, PrescanResult } from '@bookorbit/types'

export { DEFAULT_FORMAT_PRIORITY, FORMAT_LABELS }

export const DEFAULT_METADATA_PRECEDENCE = ['embedded', 'opfFile']

export const METADATA_LABELS: Record<string, string> = {
  embedded: 'Embedded metadata',
  opfFile: 'OPF files',
}

export type LibraryCreatorSectionId = 'details' | 'folders' | 'scanner' | 'metadata' | 'reading' | 'schedule' | 'fileWrite' | 'access'

const CRON_REGEX = /^((\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)? ){4}(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/
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
    formatPriority: [...DEFAULT_FORMAT_PRIORITY] as string[],
    allowedFormats: [] as string[],
    organizationMode: 'book_per_folder' as OrganizationMode,
    excludePatterns: [] as string[],
    readingThreshold: 0.25,
    markAsFinishedPercentComplete: 98,
    fileWriteEnabled: false,
    fileWriteWriteCover: true,
    fileWriteEpubEnabled: true,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWritePdfEnabled: true,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
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

  const validationErrors = computed<Partial<Record<LibraryCreatorSectionId, string>>>(() => {
    const errors: Partial<Record<LibraryCreatorSectionId, string>> = {}
    if (!form.name.trim()) errors.details = 'Enter a library name.'
    else if (!form.icon?.trim()) errors.details = 'Choose an icon.'
    if (form.folders.length === 0) errors.folders = 'Add at least one folder.'
    if (form.autoScanCronExpression && !CRON_REGEX.test(form.autoScanCronExpression)) {
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
      form.fileWriteAudioMaxFileSizeMb,
    ]
    if (fileSizes.some((value) => !Number.isInteger(value) || value < FILE_SIZE_MIN_MB || value > FILE_SIZE_MAX_MB)) {
      errors.fileWrite = 'File-size limits must be whole numbers from 1 to 10,000 MB.'
    }
    return errors
  })

  function initCreate() {
    Object.assign(form, blankForm())
    mode.value = 'create'
    editingLibraryId.value = null
    prescanResult.value = null
    error.value = null
  }

  function initEdit(library: Library) {
    form.name = library.name
    form.icon = library.icon ?? null
    form.displayOrder = library.displayOrder
    form.coverAspectRatio = library.coverAspectRatio
    form.folders = library.folders.map((f) => f.path)
    form.watch = library.watch
    form.autoScanCronExpression = library.autoScanCronExpression ?? null
    form.metadataPrecedence = [...library.metadataPrecedence]
    const missing = DEFAULT_FORMAT_PRIORITY.filter((f) => !library.formatPriority.includes(f))
    form.formatPriority = [...library.formatPriority, ...missing]
    form.allowedFormats = [...library.allowedFormats]
    form.organizationMode = library.organizationMode
    form.excludePatterns = [...library.excludePatterns]
    form.readingThreshold = library.readingThreshold
    form.markAsFinishedPercentComplete = library.markAsFinishedPercentComplete
    form.fileWriteEnabled = library.fileWriteEnabled
    form.fileWriteWriteCover = library.fileWriteWriteCover
    form.fileWriteEpubEnabled = library.fileWriteEpubEnabled
    form.fileWriteEpubMaxFileSizeMb = library.fileWriteEpubMaxFileSizeMb
    form.fileWritePdfEnabled = library.fileWritePdfEnabled
    form.fileWritePdfMaxFileSizeMb = library.fileWritePdfMaxFileSizeMb
    form.fileWriteCbxEnabled = library.fileWriteCbxEnabled
    form.fileWriteCbxMaxFileSizeMb = library.fileWriteCbxMaxFileSizeMb
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
      const res = await api('/api/v1/libraries/prescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: form.folders }),
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
      const payload = {
        ...form,
        name: form.name.trim(),
        icon: form.icon!.trim(),
        folders: [...new Set(form.folders.map((path) => path.trim()))],
      }
      let res: Response
      if (mode.value === 'create') {
        res = await api('/api/v1/libraries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await api(`/api/v1/libraries/${editingLibraryId.value}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null)
  const message = body?.message
  if (Array.isArray(message)) return message.find((entry): entry is string => typeof entry === 'string') ?? fallback
  return typeof message === 'string' && message.trim() ? message : fallback
}
