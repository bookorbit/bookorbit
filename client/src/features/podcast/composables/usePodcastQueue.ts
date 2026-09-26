import type { PodcastQueueClearResult, PodcastQueuePlacement } from '@bookorbit/types'
import { api } from '@/lib/api'
import { i18n } from '@/i18n'

/** Names the episodes a change took out of the queue, for listeners that can splice rather than refetch. */
export interface PodcastQueueChange {
  removedEpisodeIds: readonly number[]
}

type QueueChangeListener = (change?: PodcastQueueChange) => void | Promise<void>
type QueueAnchor = { episodeId: number; queued: boolean }

const listeners = new Set<QueueChangeListener>()

function notifyQueueChanged(change?: PodcastQueueChange): void {
  for (const listener of listeners) {
    try {
      const pending = listener(change)
      if (pending) void pending.catch(() => undefined)
    } catch {
      continue
    }
  }
}

/**
 * Finishing an episode dequeues it inside the same server write, so no queue endpoint is called and
 * nothing rendering the queue would otherwise hear about it. Module-level because the write sites
 * are plain API helpers rather than composables.
 */
export function notifyEpisodesDequeued(episodeIds: readonly number[]): void {
  if (episodeIds.length > 0) notifyQueueChanged({ removedEpisodeIds: episodeIds })
}

async function enqueue(episodeId: number, placement: PodcastQueuePlacement, errorMessage: string, afterEpisodeId?: number): Promise<void> {
  const response = await api(`/api/v1/podcast-episodes/${episodeId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placement, ...(afterEpisodeId === undefined ? {} : { afterEpisodeId }) }),
  })
  if (!response.ok) throw new Error(errorMessage)
}

export function usePodcastQueue() {
  const t = i18n.global.t
  async function add(episodeId: number, placement: PodcastQueuePlacement = 'end'): Promise<void> {
    await enqueue(episodeId, placement, placement === 'next' ? t('podcast.errors.queueNext') : t('podcast.errors.addToQueue'))
    notifyQueueChanged()
  }

  async function addNext(episodeId: number, anchor?: QueueAnchor): Promise<void> {
    if (anchor && !anchor.queued) await enqueue(anchor.episodeId, 'end', t('podcast.errors.addToQueue'))
    await enqueue(episodeId, 'next', t('podcast.errors.queueNext'), anchor?.episodeId)
    notifyQueueChanged()
  }

  async function remove(episodeId: number): Promise<void> {
    const response = await api(`/api/v1/podcast-episodes/${episodeId}/queue`, { method: 'DELETE' })
    if (!response.ok) throw new Error(t('podcast.errors.removeFromQueue'))
    notifyQueueChanged()
  }

  async function reorder(episodeIds: number[]): Promise<void> {
    const response = await api('/api/v1/podcast-queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeIds }),
    })
    if (!response.ok) throw new Error(t('podcast.errors.reorderQueue'))
    notifyQueueChanged()
  }

  async function clear(): Promise<PodcastQueueClearResult> {
    const response = await api('/api/v1/podcast-queue', { method: 'DELETE' })
    if (!response.ok) throw new Error(t('podcast.errors.clearQueue'))
    const result: PodcastQueueClearResult = await response.json()
    notifyQueueChanged()
    return result
  }

  async function clearFinished(): Promise<PodcastQueueClearResult> {
    const response = await api('/api/v1/podcast-queue/finished', { method: 'DELETE' })
    if (!response.ok) throw new Error(t('podcast.errors.clearQueue'))
    const result: PodcastQueueClearResult = await response.json()
    notifyQueueChanged()
    return result
  }

  async function restore(episodeIds: number[]): Promise<number> {
    const response = await api('/api/v1/podcast-queue/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeIds }),
    })
    if (!response.ok) throw new Error(t('podcast.errors.restoreQueue'))
    const result: { restored: number } = await response.json()
    notifyQueueChanged()
    return result.restored
  }

  function subscribe(listener: QueueChangeListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { add, addNext, remove, reorder, clear, clearFinished, restore, subscribe }
}
