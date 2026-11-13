import { localEngine, resolveDefaultWasmSource } from '@embedpdf/engine'

/** A new engine per viewer: the viewer starts it on mount and destroys its worker on unmount. */
export function createPdfEngine() {
  return localEngine()
}

/** Warms the HTTP cache with the engine's WebAssembly so the first PDF opens without waiting for it. */
export async function prefetchPdfEngine() {
  const { wasmUrl } = await resolveDefaultWasmSource({})
  if (wasmUrl) await fetch(wasmUrl, { cache: 'force-cache' })
}
