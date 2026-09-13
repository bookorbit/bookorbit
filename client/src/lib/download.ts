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

/** `total` is null when the response arrives without a usable `Content-Length`. */
export type DownloadProgress = { loaded: number; total: number | null }

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

function declaredLength(response: Response): number | null {
  const header = Number(response.headers.get('Content-Length'))
  return Number.isFinite(header) && header > 0 ? header : null
}

/**
 * Buffers the body a chunk at a time so the caller can report how far along a large file is.
 * `response.blob()` would be shorter, but it resolves only once the last byte has landed, which
 * on a phone connection is a minute of the UI having nothing to say.
 */
async function readBlobWithProgress(response: Response, onProgress: (progress: DownloadProgress) => void): Promise<Blob> {
  const total = declaredLength(response)
  const reader = response.body?.getReader?.()
  // A body-less Response still has to download, it just cannot be measured.
  if (!reader) {
    onProgress({ loaded: 0, total })
    return response.blob()
  }

  const contentType = response.headers.get('Content-Type') ?? ''
  const chunks: BlobPart[] = []
  let loaded = 0
  onProgress({ loaded, total })
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value as BlobPart)
    loaded += value.byteLength
    onProgress({ loaded, total })
  }
  // `response.blob()` takes the type from the header, so reassembling by hand has to as well or
  // WebKit loses the file kind and offers the sheet as an unnamed binary.
  return new Blob(chunks, { type: contentType })
}

/**
 * Downloads an attachment endpoint. Everywhere the browser owns a window it can navigate away
 * from, the link streams straight from the server so nothing has to be buffered; only the
 * trapped iOS web app pays for a blob.
 *
 * `onProgress` fires only on that buffered path, because it is the only one where the wait is
 * ours to report: a plain link hands off to the browser's own download UI immediately.
 */
export async function downloadFromUrl(url: string, fallbackFileName: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  if (!isIosStandaloneWebApp()) {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    return
  }

  // Announce the wait before the request goes out, so a slow first byte is not silent either.
  onProgress?.({ loaded: 0, total: null })

  const response = await api(url)
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
  const filename = fileNameFromContentDisposition(response.headers.get('Content-Disposition'), fallbackFileName)
  const blob = onProgress ? await readBlobWithProgress(response, onProgress) : await response.blob()
  triggerBlobDownload(blob, filename)
}
