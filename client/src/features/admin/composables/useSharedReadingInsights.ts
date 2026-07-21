import { ref, toValue, type MaybeRefOrGetter } from 'vue'
import type {
  AccountActivityDetail,
  SharedReadingInsightsDetail,
  SharedReadingInsightsSummary,
  SharedReadingInsightsViewSession,
} from '@bookorbit/types'

import { api } from '@/lib/api'

export function useSharedReadingInsights(userId: MaybeRefOrGetter<number>) {
  const account = ref<AccountActivityDetail | null>(null)
  const session = ref<SharedReadingInsightsViewSession | null>(null)
  const summary = ref<SharedReadingInsightsSummary | null>(null)
  const detail = ref<SharedReadingInsightsDetail | null>(null)
  const days = ref(90)
  const loading = ref(false)
  const errorCode = ref<string | null>(null)
  let requestVersion = 0

  async function initialize() {
    const version = ++requestVersion
    const currentUserId = toValue(userId)
    loading.value = true
    errorCode.value = null
    account.value = null
    session.value = null
    summary.value = null
    detail.value = null
    try {
      const [accountResponse, sessionResponse] = await Promise.all([
        api(`/api/v1/account-activity/${currentUserId}`),
        api(`/api/v1/shared-reading-insights/${currentUserId}/view-sessions`, { method: 'POST' }),
      ])
      if (version !== requestVersion) return
      if (!accountResponse.ok) throw new Error('LOAD_FAILED')
      account.value = (await accountResponse.json()) as AccountActivityDetail
      if (!sessionResponse.ok) {
        const payload = (await sessionResponse.json().catch(() => null)) as { errorCode?: string } | null
        throw new Error(payload?.errorCode ?? 'LOAD_FAILED')
      }
      session.value = (await sessionResponse.json()) as SharedReadingInsightsViewSession
      await loadInsights(version, currentUserId)
    } catch (error) {
      if (version !== requestVersion) return
      errorCode.value = error instanceof Error ? error.message : 'LOAD_FAILED'
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  async function loadInsights(existingVersion?: number, existingUserId?: number) {
    if (!session.value) return
    const version = existingVersion ?? ++requestVersion
    const currentUserId = existingUserId ?? toValue(userId)
    const currentSession = session.value
    loading.value = true
    errorCode.value = null
    summary.value = null
    detail.value = null
    const headers = { 'x-reading-insights-view-session': currentSession.viewSessionId }
    try {
      const summaryResponse = await api(`/api/v1/shared-reading-insights/${currentUserId}/summary?days=${days.value}`, { headers })
      if (version !== requestVersion) return
      if (!summaryResponse.ok) {
        const payload = (await summaryResponse.json().catch(() => null)) as { errorCode?: string } | null
        throw new Error(payload?.errorCode ?? 'LOAD_FAILED')
      }
      summary.value = (await summaryResponse.json()) as SharedReadingInsightsSummary
      if (summary.value.sharingLevel === 'detailed') {
        const detailResponse = await api(`/api/v1/shared-reading-insights/${currentUserId}/detailed?days=${days.value}`, { headers })
        if (version !== requestVersion) return
        if (!detailResponse.ok) {
          const payload = (await detailResponse.json().catch(() => null)) as { errorCode?: string } | null
          throw new Error(payload?.errorCode ?? 'LOAD_FAILED')
        }
        detail.value = (await detailResponse.json()) as SharedReadingInsightsDetail
      }
    } catch (error) {
      if (version !== requestVersion) return
      summary.value = null
      detail.value = null
      errorCode.value = error instanceof Error ? error.message : 'LOAD_FAILED'
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  return { account, session, summary, detail, days, loading, errorCode, initialize, loadInsights }
}
