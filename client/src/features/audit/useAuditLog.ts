import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  AuditActorOption,
  AuditCategory,
  AuditLogEntry,
  AuditLogPage,
  AuditLogSummary,
  AuditSecurityGroup,
  AuditSignInGroup,
  AuditSignInPage,
} from '@bookorbit/types'
import { api } from '@/lib/api'

export type AuditView = 'changes' | 'signins' | 'security' | 'all'
export type AuditRangePreset = 'today' | '7d' | '30d' | 'all' | 'custom'

export interface AuditPersonFilter {
  username: string
  name: string
}

export interface AuditTargetFilter {
  resource: string
  resourceId: number
  label: string
}

export const AUDIT_PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** The UTC bounds for a range preset, cut on the viewer's own days. */
export function rangeBounds(preset: AuditRangePreset, from: string, to: string, now = new Date()): { dateFrom?: string; dateTo?: string } {
  const daysBack = (days: number) => {
    const start = startOfLocalDay(now)
    start.setDate(start.getDate() - days + 1)
    return { dateFrom: start.toISOString() }
  }
  if (preset === 'today') return daysBack(1)
  if (preset === '7d') return daysBack(7)
  if (preset === '30d') return daysBack(30)
  if (preset === 'custom') {
    return {
      dateFrom: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      dateTo: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    }
  }
  return {}
}

export function useAuditLog() {
  const { t } = useI18n()

  const view = ref<AuditView>('changes')
  const search = ref('')
  const appliedSearch = ref('')
  const person = ref<AuditPersonFilter | null>(null)
  const category = ref<AuditCategory | null>(null)
  const securityGroup = ref<AuditSecurityGroup | null>(null)
  const target = ref<AuditTargetFilter | null>(null)
  const ip = ref<string | null>(null)
  const range = reactive<{ preset: AuditRangePreset; from: string; to: string }>({ preset: 'all', from: '', to: '' })
  const page = ref(1)

  const entries = ref<AuditLogEntry[]>([])
  const total = ref(0)
  const signIns = ref<AuditSignInGroup[]>([])
  const signInTotal = ref(0)
  const summary = ref<AuditLogSummary | null>(null)
  const actors = ref<AuditActorOption[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  let listRequest = 0
  let summaryRequest = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  const activeFilterCount = computed(() => (person.value ? 1 : 0) + (category.value ? 1 : 0) + (target.value ? 1 : 0) + (ip.value ? 1 : 0))
  const totalPages = computed(() => Math.max(1, Math.ceil((view.value === 'signins' ? signInTotal.value : total.value) / AUDIT_PAGE_SIZE)))

  /** The filters every endpoint shares. The view and category are added per request; sign-ins have no target. */
  function baseParams(options: { target?: boolean } = {}): URLSearchParams {
    const params = new URLSearchParams()
    if (appliedSearch.value) params.set('search', appliedSearch.value)
    if (person.value) params.set('actorUsername', person.value.username)
    if (target.value && options.target !== false) {
      params.set('resource', target.value.resource)
      params.set('resourceId', String(target.value.resourceId))
    }
    if (ip.value) params.set('ip', ip.value)
    const bounds = rangeBounds(range.preset, range.from, range.to)
    if (bounds.dateFrom) params.set('dateFrom', bounds.dateFrom)
    if (bounds.dateTo) params.set('dateTo', bounds.dateTo)
    return params
  }

  function viewParams(): URLSearchParams {
    const params = baseParams()
    if (view.value !== 'all') params.set('kind', view.value)
    if (category.value) params.set('category', category.value)
    if (view.value === 'security' && securityGroup.value) params.set('securityGroup', securityGroup.value)
    return params
  }

  async function fetchList() {
    const request = ++listRequest
    loading.value = true
    error.value = null
    try {
      if (view.value === 'signins') {
        const params = baseParams({ target: false })
        params.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
        params.set('page', String(page.value))
        params.set('pageSize', String(AUDIT_PAGE_SIZE))
        const res = await api(`/api/v1/audit-log/sign-ins?${params.toString()}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: AuditSignInPage = await res.json()
        if (request !== listRequest) return
        signIns.value = data.data
        signInTotal.value = data.total
      } else {
        const params = viewParams()
        params.set('page', String(page.value))
        params.set('pageSize', String(AUDIT_PAGE_SIZE))
        const res = await api(`/api/v1/audit-log?${params.toString()}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: AuditLogPage = await res.json()
        if (request !== listRequest) return
        entries.value = data.data
        total.value = data.total
      }
      loaded.value = true
    } catch {
      if (request === listRequest) error.value = t('audit.loadError')
    } finally {
      if (request === listRequest) loading.value = false
    }
  }

  async function fetchSummary() {
    const request = ++summaryRequest
    try {
      const params = baseParams()
      if (view.value !== 'all' && view.value !== 'signins') params.set('kind', view.value)
      const res = await api(`/api/v1/audit-log/summary?${params.toString()}`)
      if (!res.ok) return
      const data: AuditLogSummary = await res.json()
      if (request === summaryRequest) summary.value = data
    } catch {
      // Counts are a convenience; the list still loads and reports its own failure.
    }
  }

  async function fetchActors(query = '') {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (query.trim()) params.set('q', query.trim())
      const res = await api(`/api/v1/audit-log/actors?${params.toString()}`)
      if (res.ok) actors.value = await res.json()
    } catch {
      actors.value = []
    }
  }

  function refresh() {
    return Promise.all([fetchList(), fetchSummary()])
  }

  /** A filter changed: recount, and start again from the first page (the page watcher loads the list). */
  function reload() {
    void fetchSummary()
    if (page.value !== 1) page.value = 1
    else void fetchList()
  }

  watch([view, person, category, securityGroup, target, ip, appliedSearch, () => range.preset, () => range.from, () => range.to], reload)
  watch(page, () => void fetchList())
  watch(view, (next) => {
    if (next !== 'security') securityGroup.value = null
  })
  watch(search, (value) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      appliedSearch.value = value.trim()
    }, SEARCH_DEBOUNCE_MS)
  })

  function clearFilters() {
    person.value = null
    category.value = null
    target.value = null
    ip.value = null
  }

  async function exportLog(format: 'csv' | 'json') {
    const params = view.value === 'signins' ? baseParams() : viewParams()
    if (view.value === 'signins') params.set('kind', 'signins')
    params.set('format', format)
    const res = await api(`/api/v1/audit-log/export?${params.toString()}`)
    if (!res.ok) throw new Error(t('audit.export.failed'))
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `audit-log.${format}`
    const url = URL.createObjectURL(await res.blob())
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function saveRetention(days: number) {
    const res = await api('/api/v1/app-settings/audit_retention_days', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(days) }),
    })
    if (!res.ok) throw new Error(t('audit.retention.saveFailed'))
    await fetchSummary()
  }

  /** Same person, 40 minutes either side, changes only: the context an event happened in. */
  async function fetchAround(entry: AuditLogEntry): Promise<AuditLogEntry[]> {
    const at = Date.parse(entry.createdAt)
    const params = new URLSearchParams({
      actorUsername: entry.actorUsername,
      kind: 'changes',
      dateFrom: new Date(at - 40 * 60_000).toISOString(),
      dateTo: new Date(at + 40 * 60_000).toISOString(),
      pageSize: '20',
    })
    const res = await api(`/api/v1/audit-log?${params.toString()}`)
    if (!res.ok) return []
    return ((await res.json()) as AuditLogPage).data
  }

  /** Everything the log holds about one target, oldest first. */
  async function fetchHistory(entry: AuditLogEntry): Promise<{ events: AuditLogEntry[]; total: number }> {
    if (!entry.resource || entry.resourceId === null) return { events: [], total: 0 }
    const params = new URLSearchParams({ resource: entry.resource, resourceId: String(entry.resourceId), pageSize: '50' })
    const res = await api(`/api/v1/audit-log?${params.toString()}`)
    if (!res.ok) return { events: [], total: 0 }
    const data = (await res.json()) as AuditLogPage
    return { events: [...data.data].reverse(), total: data.total }
  }

  return {
    view,
    search,
    person,
    category,
    securityGroup,
    target,
    ip,
    range,
    page,
    entries,
    total,
    signIns,
    signInTotal,
    summary,
    actors,
    loading,
    loaded,
    error,
    activeFilterCount,
    totalPages,
    refresh,
    fetchActors,
    clearFilters,
    exportLog,
    saveRetention,
    fetchAround,
    fetchHistory,
  }
}
