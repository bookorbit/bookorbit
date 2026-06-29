import { computed, ref } from 'vue'
import type {
  BulkDeleteCustomIconsResponse,
  CustomIcon,
  CustomIconCatalog,
  CustomIconPage,
  CustomIconSort,
  CustomIconStageResponse,
  CustomIconUploadResponse,
  CustomIconUsage,
} from '@bookorbit/types'
import { customIconSlugFromValue } from '@bookorbit/types'
import { api } from '@/lib/api'

const icons = ref<CustomIcon[]>([])
const catalogTotal = ref(0)
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
let loadPromise: Promise<void> | null = null

const iconsBySlug = computed(() => new Map(icons.value.map((icon) => [icon.slug, icon])))
const catalogTruncated = computed(() => catalogTotal.value > icons.value.length)

async function loadCustomIcons(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await api('/api/v1/custom-icons')
    if (!res.ok) throw new Error('Failed to load custom icons')
    const catalog = (await res.json()) as CustomIconCatalog
    icons.value = catalog.items
    catalogTotal.value = catalog.total
    loaded.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load custom icons'
    throw err
  } finally {
    loading.value = false
  }
}

async function ensureCustomIconsLoaded(): Promise<void> {
  if (loaded.value) return
  if (!loadPromise) {
    loadPromise = loadCustomIcons().finally(() => {
      loadPromise = null
    })
  }
  await loadPromise
}

async function refreshCustomIcons(): Promise<void> {
  loaded.value = false
  await loadCustomIcons()
}

function invalidateCatalog(): void {
  loaded.value = false
}

function findCustomIconByValue(value: string | null | undefined): CustomIcon | null {
  const slug = customIconSlugFromValue(value)
  return slug ? (iconsBySlug.value.get(slug) ?? null) : null
}

interface FetchPageParams {
  q?: string
  sort?: CustomIconSort
  page?: number
  size?: number
}

async function fetchIconPage(params: FetchPageParams): Promise<CustomIconPage> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.sort) search.set('sort', params.sort)
  if (params.page !== undefined) search.set('page', String(params.page))
  if (params.size !== undefined) search.set('size', String(params.size))
  const res = await api(`/api/v1/custom-icons/manage?${search.toString()}`)
  if (!res.ok) throw new Error('Failed to load icons')
  return (await res.json()) as CustomIconPage
}

async function fetchIconUsage(slug: string): Promise<CustomIconUsage> {
  const res = await api(`/api/v1/custom-icons/${encodeURIComponent(slug)}/usage`)
  if (!res.ok) throw new Error('Failed to load icon usage')
  return (await res.json()) as CustomIconUsage
}

async function stageIcons(files: File[]): Promise<CustomIconStageResponse> {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  const res = await api('/api/v1/custom-icons/stage', { method: 'POST', body: form })
  const body = (await res.json().catch(() => ({}))) as CustomIconStageResponse & { message?: string }
  if (!res.ok) throw new Error(body.message ?? 'Failed to stage icons')
  return body
}

interface StagedUpload {
  file: File
  name: string
}

async function uploadStagedIcons(items: StagedUpload[]): Promise<CustomIconUploadResponse> {
  const form = new FormData()
  for (const item of items) form.append('files', item.file)
  form.append('meta', JSON.stringify(items.map((item) => ({ filename: item.file.name, name: item.name }))))
  const res = await api('/api/v1/custom-icons', { method: 'POST', body: form })
  const body = (await res.json().catch(() => ({}))) as CustomIconUploadResponse & { message?: string }
  if (!res.ok) throw new Error(body.message ?? 'Failed to upload custom icons')
  invalidateCatalog()
  return body
}

async function updateCustomIcon(slug: string, payload: { name?: string }): Promise<CustomIcon> {
  const res = await api(`/api/v1/custom-icons/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => ({}))) as CustomIcon & { message?: string }
  if (!res.ok) throw new Error(body.message ?? 'Failed to update custom icon')
  invalidateCatalog()
  return body
}

async function replaceCustomIconSvg(slug: string, file: File): Promise<CustomIcon> {
  const form = new FormData()
  form.append('file', file)
  const res = await api(`/api/v1/custom-icons/${encodeURIComponent(slug)}/svg`, { method: 'PATCH', body: form })
  const body = (await res.json().catch(() => ({}))) as CustomIcon & { message?: string }
  if (!res.ok) throw new Error(body.message ?? 'Failed to replace custom icon')
  invalidateCatalog()
  return body
}

async function deleteCustomIcon(slug: string): Promise<void> {
  const res = await api(`/api/v1/custom-icons/${encodeURIComponent(slug)}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? 'Failed to delete custom icon')
  }
  invalidateCatalog()
}

async function bulkDeleteCustomIcons(slugs: string[]): Promise<BulkDeleteCustomIconsResponse> {
  const res = await api('/api/v1/custom-icons/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slugs }),
  })
  const body = (await res.json().catch(() => ({}))) as BulkDeleteCustomIconsResponse & { message?: string }
  if (!res.ok) throw new Error(body.message ?? 'Failed to delete icons')
  invalidateCatalog()
  return body
}

export function useCustomIcons() {
  return {
    icons,
    iconsBySlug,
    catalogTotal,
    catalogTruncated,
    loading,
    loaded,
    error,
    ensureCustomIconsLoaded,
    refreshCustomIcons,
    findCustomIconByValue,
    fetchIconPage,
    fetchIconUsage,
    stageIcons,
    uploadStagedIcons,
    updateCustomIcon,
    replaceCustomIconSvg,
    deleteCustomIcon,
    bulkDeleteCustomIcons,
  }
}
