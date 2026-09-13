import { ref } from 'vue'
import { toast } from 'vue-sonner'

import { i18n } from '@/i18n'
import { formatPercent } from '@/i18n/formatters'
import type { DownloadProgress } from '@/lib/download'
import { downloadFromUrl } from '@/lib/download'
import { formatBytes } from '@/lib/formatting'

type ExportScope = 'primary' | 'all' | 'audio'

// Reached through the global instance rather than `useI18n()` because `useBookDownload` is also
// called from inside other composables, where there is no setup scope to bind to.
function t(key: string, named?: Record<string, unknown>): string {
  return named ? i18n.global.t(key, named) : i18n.global.t(key)
}

/** Null while nothing more useful than "we have started" is known yet. */
function progressMessage(progress: DownloadProgress): string | null {
  if (progress.total === null) {
    return progress.loaded > 0 ? t('book.download.progressBytes', { transferred: formatBytes(progress.loaded) }) : null
  }
  return t('book.download.progressPercent', {
    percent: formatPercent(progress.loaded / progress.total),
    total: formatBytes(progress.total),
  })
}

/**
 * A large file arrives as thousands of chunks, so the rendered message is the throttle: at whole
 * percents it settles to at most one toast update per percent instead of one per chunk.
 *
 * `showImmediately` separates the two waits. An export has to be built server-side before a byte
 * moves, so it announces itself up front; a single file streams at once, and only says anything
 * when the download is one we are buffering ourselves. Everywhere else the browser's own download
 * UI is already the indicator, and a toast would just duplicate it.
 */
function createDownloadToast(pendingMessage: string, showImmediately: boolean) {
  let id: string | number | undefined
  let shown: string | null = null

  function render(message: string) {
    if (message === shown) return
    shown = message
    id = id === undefined ? toast.loading(message) : toast.loading(message, { id })
  }

  if (showImmediately) render(pendingMessage)

  return {
    report(progress: DownloadProgress) {
      render(progressMessage(progress) ?? pendingMessage)
    },
    dismiss() {
      if (id !== undefined) toast.dismiss(id)
    },
  }
}

export function useBookDownload() {
  const isDownloading = ref(false)

  async function downloadFile(fileId: number): Promise<void> {
    const progress = createDownloadToast(t('book.download.preparing'), false)
    isDownloading.value = true
    try {
      await downloadFromUrl(`/api/v1/books/files/${fileId}/download`, 'book', progress.report)
    } catch {
      toast.error(t('book.download.failed'))
    } finally {
      progress.dismiss()
      isDownloading.value = false
    }
  }

  async function exportBooks(bookIds: number[], allFormats: boolean, scopeOverride?: ExportScope): Promise<void> {
    if (bookIds.length === 0) return
    const progress = createDownloadToast(t('book.download.preparingExport', { count: bookIds.length }), true)
    isDownloading.value = true
    try {
      const scope = scopeOverride ?? (allFormats ? 'all' : 'primary')
      const params = new URLSearchParams({
        bookIds: bookIds.join(','),
        scope,
      })
      await downloadFromUrl(`/api/v1/books/export/download?${params.toString()}`, 'bookorbit-export.zip', progress.report)
    } catch {
      toast.error(t('book.download.exportFailed'))
    } finally {
      progress.dismiss()
      isDownloading.value = false
    }
  }

  return { isDownloading, downloadFile, exportBooks }
}
