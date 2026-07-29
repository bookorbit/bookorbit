import { ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AuditActorOption, AuditLogEntry, AuditLogPage } from '@bookorbit/types'
import { api } from '@/lib/api'

interface AuditFilters {
  search: string
  action: string
  actorUsername: string
  resource: string
  dateFrom: string
  dateTo: string
}

export function useAuditLog() {
  const { t } = useI18n()
  const entries = ref<AuditLogEntry[]>([])
  const actors = ref<AuditActorOption[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = 50
  const loading = ref(false)
  const error = ref<string | null>(null)

  const filters = reactive<AuditFilters>({
    search: '',
    action: '',
    actorUsername: '',
    resource: '',
    dateFrom: '',
    dateTo: '',
  })

  async function fetchPage() {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
      if (filters.search.trim()) params.set('search', filters.search.trim())
      if (filters.action) params.set('action', filters.action)
      if (filters.actorUsername.trim()) params.set('actorUsername', filters.actorUsername.trim())
      if (filters.resource) params.set('resource', filters.resource)
      if (filters.dateFrom) params.set('dateFrom', new Date(`${filters.dateFrom}T00:00:00`).toISOString())
      if (filters.dateTo) params.set('dateTo', new Date(`${filters.dateTo}T23:59:59.999`).toISOString())

      const res = await api(`/api/v1/audit-log?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AuditLogPage = await res.json()
      entries.value = data.data
      total.value = data.total
    } catch {
      error.value = t('audit.loadError')
    } finally {
      loading.value = false
    }
  }

  async function fetchActors() {
    try {
      const res = await api('/api/v1/audit-log/actors?limit=100')
      if (!res.ok) return
      actors.value = await res.json()
    } catch {
      actors.value = []
    }
  }

  function applyFilters() {
    page.value = 1
    return fetchPage()
  }

  function clearFilters() {
    filters.search = ''
    filters.action = ''
    filters.actorUsername = ''
    filters.resource = ''
    filters.dateFrom = ''
    filters.dateTo = ''
    page.value = 1
    return fetchPage()
  }

  function goToPage(p: number) {
    page.value = p
    return fetchPage()
  }

  return {
    entries,
    actors,
    total,
    page,
    pageSize,
    loading,
    error,
    filters,
    fetchPage,
    fetchActors,
    applyFilters,
    clearFilters,
    goToPage,
  }
}
