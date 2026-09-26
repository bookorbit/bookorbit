import { computed, ref, watch, type WatchStopHandle } from 'vue'
import type { PodcastDownloadBatch, PodcastDownloadBatchItem, PodcastDownloadCompleteEvent, PodcastDownloadProgressEvent } from '@bookorbit/types'
import { api } from '@/lib/api'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'
import { usePodcastEvents } from './usePodcastEvents'

const DISMISSED_STORAGE_KEY = 'bookorbit:dismissed-podcast-download-batches'
const COMPLETED_VISIBILITY_MS = 5_000
const MAX_DISMISSED_BATCHES = 50

const batches = ref<Map<string, PodcastDownloadBatch>>(new Map())
const loading = ref(false)
const dismissed = new Set<string>(readDismissed())
const ignored = new Set<string>()
const completionTimers = new Map<string, ReturnType<typeof setTimeout>>()
const requestGeneration = createRequestGeneration()

let started = false
let stopConnectedWatch: WatchStopHandle | null = null
let stopProgress: (() => void) | null = null
let stopComplete: (() => void) | null = null

const visibleBatches = computed(() => [...batches.value.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)))

function readDismissed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-MAX_DISMISSED_BATCHES) : []
  } catch {
    return []
  }
}

function persistDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...dismissed].slice(-MAX_DISMISSED_BATCHES)))
  } catch {
    return
  }
}

function replaceBatch(batch: PodcastDownloadBatch): void {
  if (dismissed.has(batch.id)) return
  batches.value = new Map(batches.value).set(batch.id, batch)
  scheduleCompletedRemoval(batch)
}

function removeBatch(batchId: string): void {
  const timer = completionTimers.get(batchId)
  if (timer) clearTimeout(timer)
  completionTimers.delete(batchId)
  const next = new Map(batches.value)
  next.delete(batchId)
  batches.value = next
}

function isTerminal(batch: PodcastDownloadBatch): boolean {
  return batch.queued === 0 && batch.downloading === 0
}

function scheduleCompletedRemoval(batch: PodcastDownloadBatch): void {
  const previous = completionTimers.get(batch.id)
  if (previous) clearTimeout(previous)
  completionTimers.delete(batch.id)
  if (!isTerminal(batch) || batch.failed > 0) return
  completionTimers.set(
    batch.id,
    setTimeout(() => removeBatch(batch.id), COMPLETED_VISIBILITY_MS),
  )
}

function recalculate(batch: PodcastDownloadBatch): void {
  batch.total = batch.items.length
  batch.queued = 0
  batch.downloading = 0
  batch.completed = 0
  batch.failed = 0
  batch.cancelled = 0
  batch.receivedBytes = 0
  batch.totalBytes = 0
  for (const item of batch.items) {
    batch[item.status]++
    batch.receivedBytes += item.receivedBytes
    batch.totalBytes = batch.totalBytes === null || item.totalBytes === null ? null : batch.totalBytes + item.totalBytes
  }
  batch.updatedAt = new Date().toISOString()
  scheduleCompletedRemoval(batch)
  batches.value = new Map(batches.value)
}

function findItem(batch: PodcastDownloadBatch, episodeId: number): PodcastDownloadBatchItem | undefined {
  return batch.items.find((item) => item.episodeId === episodeId)
}

const fetchBatchById = createCoalescedFetch(
  async (batchId: string): Promise<void> => {
    const generation = requestGeneration.current()
    try {
      const response = await api(`/api/v1/podcast-download-batches/${encodeURIComponent(batchId)}`)
      if (!requestGeneration.isCurrent(generation)) return
      if (response.ok) replaceBatch((await response.json()) as PodcastDownloadBatch)
      else if (response.status === 404) {
        ignored.add(batchId)
        removeBatch(batchId)
      }
    } catch {
      return
    }
  },
  (batchId) => batchId,
)

async function fetchBatch(batchId: string): Promise<void> {
  if (dismissed.has(batchId) || ignored.has(batchId)) return
  return fetchBatchById(batchId)
}

const loadActive = createCoalescedFetch(async (): Promise<void> => {
  const generation = requestGeneration.current()
  loading.value = true
  try {
    const response = await api('/api/v1/podcast-download-batches')
    if (!response.ok) return
    const active = (await response.json()) as PodcastDownloadBatch[]
    if (!requestGeneration.isCurrent(generation)) return
    const next = new Map<string, PodcastDownloadBatch>()
    for (const batch of active) {
      if (!dismissed.has(batch.id)) {
        ignored.delete(batch.id)
        next.set(batch.id, batch)
      }
    }
    batches.value = next
  } catch {
    return
  } finally {
    if (requestGeneration.isCurrent(generation)) loading.value = false
  }
})

function handleProgress(event: PodcastDownloadProgressEvent): void {
  if (!event.batchId || dismissed.has(event.batchId) || ignored.has(event.batchId)) return
  const batch = batches.value.get(event.batchId)
  const item = batch && findItem(batch, event.episodeId)
  if (!batch || !item) {
    void fetchBatch(event.batchId)
    return
  }
  item.status = event.status
  item.receivedBytes = event.receivedBytes
  item.totalBytes = event.totalBytes
  recalculate(batch)
}

function handleComplete(event: PodcastDownloadCompleteEvent): void {
  if (!event.batchId || dismissed.has(event.batchId) || ignored.has(event.batchId)) return
  const batch = batches.value.get(event.batchId)
  const item = batch && findItem(batch, event.episodeId)
  if (!batch || !item || !event.jobStatus) {
    void fetchBatch(event.batchId)
    return
  }
  item.status = event.jobStatus === 'queued' ? 'queued' : event.jobStatus
  if (item.status === 'completed') {
    const finalBytes = event.localSizeBytes ?? item.totalBytes
    if (finalBytes !== null) {
      item.receivedBytes = finalBytes
      item.totalBytes = finalBytes
    }
  }
  recalculate(batch)
}

function start(): void {
  if (started) return
  started = true
  const events = usePodcastEvents()
  stopProgress = events.onDownloadProgress(handleProgress)
  stopComplete = events.onDownloadComplete(handleComplete)
  stopConnectedWatch = watch(events.connected, (connected, wasConnected) => {
    if (connected && connected !== wasConnected) void loadActive()
  })
  void loadActive()
}

function stop(): void {
  started = false
  stopProgress?.()
  stopComplete?.()
  stopConnectedWatch?.()
  stopProgress = null
  stopComplete = null
  stopConnectedWatch = null
}

function dismiss(batchId: string): void {
  dismissed.add(batchId)
  persistDismissed()
  removeBatch(batchId)
}

async function track(batchId: string | null): Promise<void> {
  if (!batchId) return
  dismissed.delete(batchId)
  ignored.delete(batchId)
  persistDismissed()
  await fetchBatch(batchId)
}

function resetForUserChange(): void {
  requestGeneration.invalidate()
  loadActive.clear()
  fetchBatchById.clear()
  loading.value = false
  ignored.clear()
  for (const timer of completionTimers.values()) clearTimeout(timer)
  completionTimers.clear()
  batches.value = new Map()
  if (started) void loadActive()
}

export function usePodcastDownloadBatches() {
  return { batches: visibleBatches, loading, start, stop, dismiss, track, resetForUserChange, loadActive }
}
