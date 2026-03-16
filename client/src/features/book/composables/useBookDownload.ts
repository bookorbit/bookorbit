import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'

export function useBookDownload() {
  const isDownloading = ref(false)

  async function downloadFile(fileId: number): Promise<void> {
    isDownloading.value = true
    try {
      const res = await api(`/api/v1/books/files/${fileId}/serve?download=1`)
      if (!res.ok) {
        toast.error('Download failed')
        return
      }
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i)
      const filename = match?.[1] ? decodeURIComponent(match[1].trim()) : 'download'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
    } finally {
      isDownloading.value = false
    }
  }

  async function exportBooks(bookIds: number[], allFormats: boolean): Promise<void> {
    if (bookIds.length === 0) return
    const label = `${bookIds.length} book${bookIds.length === 1 ? '' : 's'}`
    const toastId = toast.loading(`Preparing ${label} for download...`)
    isDownloading.value = true
    try {
      const res = await api('/api/v1/books/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds, allFormats }),
      })
      toast.dismiss(toastId)
      if (!res.ok) {
        toast.error('Export failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'books.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.dismiss(toastId)
      toast.error('Export failed')
    } finally {
      isDownloading.value = false
    }
  }

  return { isDownloading, downloadFile, exportBooks }
}
