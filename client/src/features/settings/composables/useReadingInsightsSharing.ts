import { ref } from 'vue'
import type {
  ReadingInsightsAccessHistoryPage,
  ReadingInsightsPreview,
  ReadingInsightsSharingLevel,
  ReadingInsightsSharingSettings,
  SharedReadingInsightsDetail,
  SharedReadingInsightsSummary,
} from '@bookorbit/types'

import { api } from '@/lib/api'

export function useReadingInsightsSharing() {
  const settings = ref<ReadingInsightsSharingSettings>({ sharingLevel: 'private', consentedAt: null })
  const history = ref<ReadingInsightsAccessHistoryPage>({ items: [], total: 0, page: 1, pageSize: 20 })
  const previewSummary = ref<SharedReadingInsightsSummary | null>(null)
  const previewDetail = ref<SharedReadingInsightsDetail | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const historyLoading = ref(false)
  const saving = ref(false)
  const previewLoading = ref(false)
  const error = ref<string | null>(null)
  let loadVersion = 0
  let historyVersion = 0
  let previewVersion = 0
  let updateVersion = 0

  async function load() {
    const version = ++loadVersion
    loading.value = true
    error.value = null
    try {
      const [settingsResponse, historyResponse] = await Promise.all([
        api('/api/v1/reading-insights-sharing/me'),
        api('/api/v1/reading-insights-sharing/me/access-history?page=1&pageSize=20'),
      ])
      if (version !== loadVersion) return
      if (!settingsResponse.ok || !historyResponse.ok) throw new Error('load')
      settings.value = (await settingsResponse.json()) as ReadingInsightsSharingSettings
      history.value = (await historyResponse.json()) as ReadingInsightsAccessHistoryPage
      loaded.value = true
    } catch {
      if (version !== loadVersion) return
      loaded.value = false
      error.value = 'load'
    } finally {
      if (version === loadVersion) loading.value = false
    }
  }

  async function loadHistory(page: number) {
    const version = ++historyVersion
    historyLoading.value = true
    error.value = null
    try {
      const response = await api(`/api/v1/reading-insights-sharing/me/access-history?page=${page}&pageSize=${history.value.pageSize}`)
      if (version !== historyVersion) return
      if (!response.ok) throw new Error('load')
      history.value = (await response.json()) as ReadingInsightsAccessHistoryPage
    } catch {
      if (version !== historyVersion) return
      error.value = 'load'
    } finally {
      if (version === historyVersion) historyLoading.value = false
    }
  }

  async function update(sharingLevel: ReadingInsightsSharingLevel): Promise<boolean> {
    const version = ++updateVersion
    saving.value = true
    error.value = null
    try {
      const response = await api('/api/v1/reading-insights-sharing/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharingLevel }),
      })
      if (version !== updateVersion) return false
      if (!response.ok) throw new Error('save')
      settings.value = (await response.json()) as ReadingInsightsSharingSettings
      previewSummary.value = null
      previewDetail.value = null
      return true
    } catch {
      if (version !== updateVersion) return false
      error.value = 'save'
      return false
    } finally {
      if (version === updateVersion) saving.value = false
    }
  }

  async function loadPreview(days = 90) {
    const version = ++previewVersion
    previewLoading.value = true
    error.value = null
    previewSummary.value = null
    previewDetail.value = null
    try {
      const response = await api(`/api/v1/reading-insights-sharing/me/preview?days=${days}`)
      if (version !== previewVersion) return
      if (!response.ok) throw new Error('preview')
      const data = (await response.json()) as ReadingInsightsPreview
      if ('summary' in data) {
        previewSummary.value = data.summary
        previewDetail.value = data.detail
      } else if ('periodDays' in data) {
        previewSummary.value = data
      }
    } catch {
      if (version !== previewVersion) return
      error.value = 'preview'
    } finally {
      if (version === previewVersion) previewLoading.value = false
    }
  }

  return {
    settings,
    history,
    previewSummary,
    previewDetail,
    loading,
    loaded,
    historyLoading,
    saving,
    previewLoading,
    error,
    load,
    loadHistory,
    update,
    loadPreview,
  }
}
