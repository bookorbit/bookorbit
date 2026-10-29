export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy API below.
    }
  }

  if (typeof document === 'undefined' || !document.body) return false
  const textarea = document.createElement('textarea')
  try {
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

/** Images have no legacy fallback: they copy only where the async clipboard and `ClipboardItem` exist (secure origins). */
export function canCopyImages(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
}

/**
 * Copies a PNG. Takes the blob as a promise so the `ClipboardItem` is made inside the click that
 * asked for it, which Safari requires; resolves false when the browser refuses.
 */
export async function copyImageToClipboard(png: Promise<Blob>): Promise<boolean> {
  if (!canCopyImages()) return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    return true
  } catch {
    return false
  }
}
