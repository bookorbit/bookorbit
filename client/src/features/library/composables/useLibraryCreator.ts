import { reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { DEFAULT_FORMAT_PRIORITY, FORMAT_LABELS } from '@projectx/types'
import type { CoverAspectRatio, Library, OrganizationMode, PrescanResult } from '@projectx/types'

export { DEFAULT_FORMAT_PRIORITY, FORMAT_LABELS }

export const DEFAULT_METADATA_PRECEDENCE = ['embedded', 'opfFile']

export const METADATA_LABELS: Record<string, string> = {
  embedded: 'Embedded metadata',
  opfFile: 'OPF files',
}

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
    mode.value = 'edit'
    editingLibraryId.value = library.id
    prescanResult.value = null
    error.value = null
  }

  async function runPrescan() {
    if (form.folders.length === 0) return
    prescanLoading.value = true
    prescanResult.value = null
    try {
      const res = await api('/api/v1/libraries/prescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: form.folders }),
      })
      if (res.ok) {
        prescanResult.value = await res.json()
      }
    } finally {
      prescanLoading.value = false
    }
  }

  async function save(): Promise<Library | null> {
    if (!form.name.trim()) {
      error.value = 'Library name is required'
      return null
    }
    if (form.folders.length === 0) {
      error.value = 'At least one folder is required'
      return null
    }
    error.value = null
    loading.value = true
    try {
      const payload = { ...form }
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
        const body = await res.json().catch(() => ({}))
        error.value = body?.message ?? 'Failed to save library'
        return null
      }
      return await res.json()
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
    initCreate,
    initEdit,
    runPrescan,
    save,
  }
}
