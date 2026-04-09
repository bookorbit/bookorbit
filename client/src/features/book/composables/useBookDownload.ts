import { ref } from 'vue'
import { toast } from 'vue-sonner'

type ExportScope = 'primary' | 'all' | 'audio'

function triggerBrowserDownload(url: string, filename?: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  if (filename) anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

export function useBookDownload() {
  const isDownloading = ref(false)

  async function downloadFile(fileId: number): Promise<void> {
    isDownloading.value = true
    try {
      triggerBrowserDownload(`/api/v1/books/files/${fileId}/download`)
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
      toast.dismiss(toastId)
      triggerBrowserDownload(`/api/v1/books/export/download?${params.toString()}`, 'books.zip')
    } catch {
      toast.dismiss(toastId)
      toast.error('Export failed')
    } finally {
      isDownloading.value = false
    }
  }

  return { isDownloading, downloadFile, exportBooks }
}
