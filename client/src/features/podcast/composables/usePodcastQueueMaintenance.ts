import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { formatNumber } from '@/i18n/formatters'
import { usePodcastQueue } from './usePodcastQueue'

export type PodcastQueueConfirmation = 'clearAll' | 'clearPlayed'

/**
 * Emptying the queue in one click, with a way back. Both clears are destructive and neither has a
 * server-side trash, so the response carries the ids it removed and the toast offers to put them
 * back in the same order.
 */
export function usePodcastQueueMaintenance(reloadQueue: () => Promise<void>) {
  const { t } = useI18n()
  const queue = usePodcastQueue()

  const pending = ref<PodcastQueueConfirmation | null>(null)
  const clearingAll = ref(false)
  const clearingFinished = ref(false)
  const restoring = ref(false)

  const confirmation = computed(() =>
    pending.value === 'clearAll'
      ? {
          title: t('podcast.actions.clearQueue'),
          description: t('podcast.library.confirmClearQueue'),
          confirmLabel: t('podcast.actions.clearAll'),
          busy: clearingAll.value,
        }
      : {
          title: t('podcast.actions.clearPlayed'),
          description: t('podcast.library.confirmClearPlayed'),
          confirmLabel: t('podcast.actions.clearPlayed'),
          busy: clearingFinished.value,
        },
  )

  function requestClearAll(): void {
    pending.value = 'clearAll'
  }

  function requestClearFinished(): void {
    pending.value = 'clearPlayed'
  }

  function cancel(): void {
    pending.value = null
  }

  function confirm(): void {
    if (pending.value === 'clearAll') void clearAll()
    else if (pending.value === 'clearPlayed') void clearFinished()
  }

  async function clearAll(): Promise<void> {
    await runClear(clearingAll, () => queue.clear(), 'podcast.messages.queueCleared')
  }

  async function clearFinished(): Promise<void> {
    await runClear(clearingFinished, () => queue.clearFinished(), 'podcast.messages.finishedQueueCleared')
  }

  async function runClear(busy: typeof clearingAll, clear: () => Promise<{ previousEpisodeIds: number[] }>, successKey: string): Promise<void> {
    busy.value = true
    try {
      const result = await clear()
      pending.value = null
      await reloadQueue()
      toast.success(t(successKey), undoAction(result.previousEpisodeIds))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.errors.clearQueue'))
    } finally {
      busy.value = false
    }
  }

  function undoAction(previousEpisodeIds: number[]) {
    if (previousEpisodeIds.length === 0) return undefined
    return { action: { label: t('common.undo'), onClick: () => void restore(previousEpisodeIds) } }
  }

  async function restore(episodeIds: number[]): Promise<void> {
    if (restoring.value) return
    restoring.value = true
    try {
      const restored = await queue.restore(episodeIds)
      await reloadQueue()
      toast.success(t('podcast.messages.queueRestored', { count: formatNumber(restored) }))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.errors.restoreQueue'))
    } finally {
      restoring.value = false
    }
  }

  return { pending, confirmation, clearingAll, clearingFinished, requestClearAll, requestClearFinished, cancel, confirm }
}
