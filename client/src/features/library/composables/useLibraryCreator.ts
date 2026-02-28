import { reactive, ref } from 'vue'
import { api } from '@/lib/api'
import type { Library, OrganizationMode, PrescanResult } from '@projectx/types'

export const DEFAULT_METADATA_PRECEDENCE = ['embedded', 'opfFile']
export const DEFAULT_FORMAT_PRIORITY = ['epub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2']

export const METADATA_LABELS: Record<string, string> = {
  embedded: 'Embedded metadata',
  opfFile: 'OPF files',
}

export const FORMAT_LABELS: Record<string, string> = {
  epub: 'EPUB',
  pdf: 'PDF',
  cbz: 'CBZ',
  cbr: 'CBR',
  cb7: 'CB7',
  mobi: 'MOBI',
  azw3: 'AZW3',
  azw: 'AZW',
  fb2: 'FB2',
}

function blankForm() {
  return {
    name: '',
    icon: null as string | null,
    displayOrder: 0,
    folders: [] as string[],
    watch: false,
    autoScanCronExpression: null as string | null,
    metadataPrecedence: [...DEFAULT_METADATA_PRECEDENCE],
    formatPriority: [...DEFAULT_FORMAT_PRIORITY],
    allowedFormats: [] as string[],
    organizationMode: 'auto' as OrganizationMode,
    excludePatterns: [] as string[],
    markAsFinishedSecondsRemaining: null as number | null,
    markAsFinishedPercentComplete: null as number | null,
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
    form.folders = library.folders.map((f) => f.path)
    form.watch = library.watch
    form.autoScanCronExpression = library.autoScanCronExpression ?? null
    form.metadataPrecedence = [...library.metadataPrecedence]
    form.formatPriority = [...library.formatPriority]
    form.allowedFormats = [...library.allowedFormats]
    form.organizationMode = library.organizationMode
    form.excludePatterns = [...library.excludePatterns]
    form.markAsFinishedSecondsRemaining = library.markAsFinishedSecondsRemaining ?? null
    form.markAsFinishedPercentComplete = library.markAsFinishedPercentComplete ?? null
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
