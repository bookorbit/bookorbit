import { ref } from 'vue'
import { toast } from 'vue-sonner'

import { downloadFromUrl } from '@/lib/download'

type ExportScope = 'primary' | 'all' | 'audio'

export function useBookDownload() {
  const isDownloading = ref(false)

  async function downloadFile(fileId: number): Promise<void> {
    isDownloading.value = true
    try {
      await downloadFromUrl(`/api/v1/books/files/${fileId}/download`, 'book')
    } catch {
      toast.error('Download failed')
    } finally {
      isDownloading.value = false
    }
  }

  async function exportBooks(bookIds: number[], allFormats: boolean, scopeOverride?: ExportScope): Promise<void> {
    if (bookIds.length === 0) return
    const label = `${bookIds.length} book${bookIds.length === 1 ? '' : 's'}`
    const toastId = toast.loading(`Preparing ${label} for download...`)
    isDownloading.value = true
    try {
      const scope = scopeOverride ?? (allFormats ? 'all' : 'primary')
      const params = new URLSearchParams({
        bookIds: bookIds.join(','),
        scope,
      })
      await downloadFromUrl(`/api/v1/books/export/download?${params.toString()}`, 'bookorbit-export.zip')
    } catch {
      toast.error('Export failed')
    } finally {
      toast.dismiss(toastId)
      isDownloading.value = false
    }
  }

  return { isDownloading, downloadFile, exportBooks }
}
