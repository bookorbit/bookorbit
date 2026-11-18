interface ConnectionHint {
  saveData?: boolean
}

let requested = false

/**
 * Warms the HTTP cache with the PDF reader and its engine (about 3 MB on the wire) so the first
 * PDF opens without waiting for them. Only a page that can open a PDF asks, at most once per load,
 * and never on a connection asking to save data: the engine is too large to fetch on spec.
 */
export function prefetchPdfReader(): void {
  if (requested) return
  const connection = (navigator as Navigator & { connection?: ConnectionHint }).connection
  if (connection?.saveData) return
  requested = true
  const run = () => {
    void Promise.all([import('./PdfV4ReaderView.vue'), import('./pdf-engine')])
      .then(([, engine]) => engine.prefetchPdfEngine())
      .catch(() => {
        requested = false
      })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 5_000 })
  else setTimeout(run, 1_000)
}

export function resetPdfReaderPrefetchForTests(): void {
  requested = false
}
