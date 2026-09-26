import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PodcastBulkActionResult, PodcastBulkPurgePreview } from '@bookorbit/types'
import { apiJson, errorMessage, jsonBody } from '@/lib/api-json'
import { formatBytes } from '@/lib/formatting'

/**
 * Permanently deletes a selection of shows, in two steps so the confirmation can name what it is
 * about to destroy. The preview is what decides how much confirmation is asked for: a selection with
 * cached files on disk escalates to typed input, exactly as deleting one show already does, while a
 * selection of shows whose folders are already gone needs no more than a click.
 *
 * The ids are passed to `confirm` rather than captured at `open`, so a selection the user adjusts
 * while the dialog is open cannot delete a set the preview never described.
 */
export function usePodcastBulkDelete(libraryId: Ref<number>) {
  const { t } = useI18n()

  const open = ref(false)
  const preview = ref<PodcastBulkPurgePreview | null>(null)
  const preparing = ref(false)
  const deleting = ref(false)
  const error = ref<string | null>(null)

  const needsTypedConfirmation = computed(() => (preview.value?.bytes ?? 0) > 0)

  /** Names what is about to go, so the confirmation is about this selection rather than deletion in general. */
  const description = computed(() => {
    const current = preview.value
    if (!current) return ''
    return current.bytes > 0
      ? t('podcast.bulkDelete.descriptionWithFiles', { count: current.shows, size: formatBytes(current.bytes) })
      : t('podcast.bulkDelete.description', { count: current.shows })
  })

  async function prepare(podcastIds: number[]): Promise<boolean> {
    if (podcastIds.length === 0) return false
    preparing.value = true
    error.value = null
    preview.value = null
    try {
      preview.value = await apiJson<PodcastBulkPurgePreview>(
        `/api/v1/podcast-libraries/${libraryId.value}/shows/bulk-purge-preview`,
        jsonBody('POST', { podcastIds }),
        'podcast.bulkDelete.errors.prepare',
      )
      open.value = true
      return true
    } catch (reason) {
      error.value = errorMessage(reason, 'podcast.bulkDelete.errors.prepare')
      return false
    } finally {
      preparing.value = false
    }
  }

  async function confirm(podcastIds: number[]): Promise<PodcastBulkActionResult | null> {
    if (podcastIds.length === 0) return null
    deleting.value = true
    error.value = null
    try {
      const result = await apiJson<PodcastBulkActionResult>(
        `/api/v1/podcast-libraries/${libraryId.value}/shows/bulk-delete`,
        jsonBody('POST', { podcastIds }),
        'podcast.bulkDelete.errors.delete',
      )
      close()
      return result
    } catch (reason) {
      error.value = errorMessage(reason, 'podcast.bulkDelete.errors.delete')
      return null
    } finally {
      deleting.value = false
    }
  }

  function close(): void {
    open.value = false
    preview.value = null
    error.value = null
  }

  /**
   * What to tell the user once the queue accepted the work. Deletion is a job, so this reports what
   * was queued rather than claiming the shows are already gone.
   */
  function resultMessage(result: PodcastBulkActionResult): string {
    if (result.failed > 0) {
      return t('podcast.bulkDelete.queuedWithFailures', { count: result.completed, failed: result.failed })
    }
    return t('podcast.bulkDelete.queued', { count: result.completed })
  }

  return { open, preview, preparing, deleting, error, needsTypedConfirmation, description, prepare, confirm, close, resultMessage }
}
