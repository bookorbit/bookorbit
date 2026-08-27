import { api } from '@/lib/api'

/**
 * An iOS home-screen web app runs without any browser chrome, so sending it to a
 * `Content-Disposition: attachment` URL replaces the app with WebKit's document preview and
 * strands the user there: no back button, and the back-swipe is inert. Neither the `download`
 * attribute nor `target="_blank"` is honoured in that context, so the only way to keep the app
 * on screen is to fetch the response ourselves and hand the browser a blob, which WebKit shows
 * in a sheet the user can dismiss.
 */
function isIosStandaloneWebApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Revoking while the browser is still reading the blob cancels the download, so outlive the click. */
const OBJECT_URL_TTL_MS = 60_000

export function fileNameFromContentDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      // Fall through to regular filename parser.
    }
  }
  const asciiMatch = disposition.match(/filename="([^"]+)"/i)
  return asciiMatch?.[1] || fallback
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_TTL_MS)
}

/**
 * Downloads an attachment endpoint. Everywhere the browser owns a window it can navigate away
 * from, the link streams straight from the server so nothing has to be buffered; only the
 * trapped iOS web app pays for a blob.
 */
export async function downloadFromUrl(url: string, fallbackFileName: string): Promise<void> {
  if (!isIosStandaloneWebApp()) {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    return
  }

  const response = await api(url)
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
  const blob = await response.blob()
  triggerBlobDownload(blob, fileNameFromContentDisposition(response.headers.get('Content-Disposition'), fallbackFileName))
}
