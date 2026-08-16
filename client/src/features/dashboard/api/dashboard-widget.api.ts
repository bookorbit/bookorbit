import {
  DASHBOARD_WIDGET_BATCH_MAX,
  WIDGET_TYPE,
  type DashboardWidgetBatchRequest,
  type DashboardWidgetBatchResponse,
  type WidgetDataByType,
  type WidgetType,
} from '@bookorbit/types'
import { api } from '@/lib/api'

type PendingWidgetRequest = {
  type: WidgetType
  resolve: (data: never) => void
  reject: (reason?: unknown) => void
}

const pendingRequests: PendingWidgetRequest[] = []
let batchScheduled = false

function scheduleBatch(): void {
  if (batchScheduled) return
  batchScheduled = true
  queueMicrotask(() => void flushBatch())
}

async function flushBatch(): Promise<void> {
  batchScheduled = false
  const batch = pendingRequests.splice(0, DASHBOARD_WIDGET_BATCH_MAX)
  if (batch.length === 0) return
  if (pendingRequests.length > 0) scheduleBatch()

  try {
    const body: DashboardWidgetBatchRequest = { widgets: [...new Set(batch.map((request) => request.type))] }
    const response = await api('/api/v1/dashboard/widgets/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error('Dashboard widget batch failed')

    const payload: DashboardWidgetBatchResponse = await response.json()
    const resultsByType = new Map(payload.items.map((item) => [item.type, item]))
    for (const request of batch) {
      const result = resultsByType.get(request.type)
      if (!result) request.reject(new Error(`Dashboard widget batch result missing: ${request.type}`))
      else if (result.failed) request.reject(new Error(`Dashboard widget failed: ${request.type}`))
      else request.resolve(result.data as never)
    }
  } catch (error) {
    for (const request of batch) request.reject(error)
  }
}

/**
 * Collects the widgets mounting on this tick into one request.
 *
 * Twelve widgets each fetching for themselves, alongside the shelves and the sidebar, put a
 * dashboard load far past the six connections a browser opens to one origin. The queued requests
 * are the ones that go missing, and a widget that loses its request has no way back.
 */
function requestWidget<T extends WidgetType>(type: T): Promise<WidgetDataByType[T]> {
  return new Promise<WidgetDataByType[T]>((resolve, reject) => {
    pendingRequests.push({ type, resolve: resolve as (data: never) => void, reject })
    scheduleBatch()
  })
}

export function fetchReadingGoal() {
  return requestWidget(WIDGET_TYPE.READING_GOAL)
}

export function fetchCurrentlyReading() {
  return requestWidget(WIDGET_TYPE.CURRENTLY_READING)
}

export function fetchReadingStreak() {
  return requestWidget(WIDGET_TYPE.READING_STREAK)
}

export function fetchLibraryOverview() {
  return requestWidget(WIDGET_TYPE.LIBRARY_OVERVIEW)
}

export function fetchHighlightOfTheDay() {
  return requestWidget(WIDGET_TYPE.HIGHLIGHT_OF_THE_DAY)
}

export function fetchMonthlyChallenge() {
  return requestWidget(WIDGET_TYPE.MONTHLY_CHALLENGE)
}

export function fetchYearProjection() {
  return requestWidget(WIDGET_TYPE.YEAR_PROJECTION)
}

export function fetchNeglectedGems() {
  return requestWidget(WIDGET_TYPE.NEGLECTED_GEMS)
}

export function fetchReadingDna() {
  return requestWidget(WIDGET_TYPE.READING_DNA)
}

export function fetchLongWait() {
  return requestWidget(WIDGET_TYPE.LONG_WAIT)
}

export function fetchDiversityScore() {
  return requestWidget(WIDGET_TYPE.DIVERSITY_SCORE)
}

export function fetchReadingRhythm() {
  return requestWidget(WIDGET_TYPE.READING_RHYTHM)
}
