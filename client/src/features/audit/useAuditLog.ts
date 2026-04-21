import { ref, reactive } from 'vue'
import type { AuditLogEntry, AuditLogPage } from '@bookorbit/types'
import { api } from '@/lib/api'

interface AuditFilters {
  action: string
  userId: string
  dateFrom: string
  dateTo: string
}

export function useAuditLog() {
  const entries = ref<AuditLogEntry[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = 50
  const loading = ref(false)
  const error = ref<string | null>(null)

  const filters = reactive<AuditFilters>({
    action: '',
    userId: '',
    dateFrom: '',
    dateTo: '',
  })

  async function fetchPage() {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
      if (filters.action) params.set('action', filters.action)
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.dateFrom) params.set('dateFrom', new Date(filters.dateFrom).toISOString())
      if (filters.dateTo) params.set('dateTo', new Date(filters.dateTo).toISOString())

      const res = await api(`/api/v1/audit-log?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AuditLogPage = await res.json()
      entries.value = data.data
      total.value = data.total
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load audit log'
    } finally {
      loading.value = false
    }
  }

  function applyFilters() {
    page.value = 1
    fetchPage()
  }

  function clearFilters() {
    filters.action = ''
    filters.userId = ''
    filters.dateFrom = ''
    filters.dateTo = ''
    page.value = 1
    fetchPage()
  }

  function goToPage(p: number) {
    page.value = p
    fetchPage()
  }

  return {
    entries,
    total,
    page,
    pageSize,
    loading,
    error,
    filters,
    fetchPage,
    applyFilters,
    clearFilters,
    goToPage,
  }
}
