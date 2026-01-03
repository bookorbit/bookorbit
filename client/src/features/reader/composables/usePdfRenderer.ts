import { nextTick, ref } from 'vue'
import type * as pdfjsLib from 'pdfjs-dist'
import type { ComputedRef, Ref } from 'vue'
import type { PageDim } from './usePdf'

type RenderPageFn = (pageNum: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>
type GetTextContentFn = (pageNum: number) => Promise<{ content: pdfjsLib.TextContent; viewport: pdfjsLib.PageViewport } | null>
type OnDimUpdateFn = (pageNum: number, dim: PageDim) => void

export function usePdfRenderer(
  renderPageFn: RenderPageFn,
  getTextContentFn: GetTextContentFn,
  scale: ComputedRef<number>,
  rotation: Ref<0 | 90 | 180 | 270>,
  totalPages: Ref<number>,
  onDimUpdate: OnDimUpdateFn,
) {
  const canvasMap = ref(new Map<number, HTMLCanvasElement>())
  const textLayerMap = ref(new Map<number, HTMLElement>())

  const rendered = new Set<number>()
  let renderQueue: number[] = []
  let isRendering = false
  let ioEntries: IntersectionObserverEntry[] = []
  let io: IntersectionObserver | null = null

  function enqueue(pageNum: number) {
    if (rendered.has(pageNum) || renderQueue.includes(pageNum)) return
    renderQueue.push(pageNum)
    flushQueue()
  }

  async function flushQueue() {
    if (isRendering) return
    isRendering = true
    while (renderQueue.length > 0) {
      const pageNum = renderQueue.shift()!
      const canvas = canvasMap.value.get(pageNum)
      if (!canvas) continue
      await renderPageFn(pageNum, canvas, scale.value)
      // Report natural dim back so layout can correct any initial estimate.
      onDimUpdate(pageNum, { width: canvas.width / scale.value, height: canvas.height / scale.value })
      rendered.add(pageNum)
      await buildTextLayer(pageNum)
    }
    isRendering = false
  }

  async function buildTextLayer(pageNum: number) {
    const container = textLayerMap.value.get(pageNum)
    if (!container) return
    const result = await getTextContentFn(pageNum)
    if (!result) return
    const { content, viewport } = result
    const scaledVp = viewport.clone({ scale: scale.value, rotation: rotation.value })
    container.innerHTML = ''
    container.style.width = `${scaledVp.width}px`
    container.style.height = `${scaledVp.height}px`
    const s = scale.value
    for (const item of content.items) {
      if (!('str' in item) || !(item as pdfjsLib.TextItem).str.trim()) continue
      const { str, transform, height } = item as pdfjsLib.TextItem
      const [a, b, , , e, f] = transform
      const span = document.createElement('span')
      span.textContent = str
      span.style.cssText =
        `position:absolute;` +
        `left:${e * s}px;` +
        `top:${scaledVp.height - f * s - (height ?? 0) * s}px;` +
        `font-size:${Math.abs(a * s) || Math.abs(b * s)}px;` +
        `transform-origin:0% 0%;white-space:pre;color:transparent;cursor:text;`
      container.appendChild(span)
    }
  }

  function ioCallback(entries: IntersectionObserverEntry[]) {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const nums = (e.target as HTMLElement).dataset.pages?.split(',').map(Number) ?? []
      for (const n of nums) {
        enqueue(n)
        if (n > 1) enqueue(n - 1)
        if (n < totalPages.value) enqueue(n + 1)
      }
    }
    ioEntries = entries
  }

  // Clear render state and re-trigger visible pages — call after zoom, rotation, or resize.
  function invalidate() {
    rendered.clear()
    renderQueue = []
    isRendering = false
    nextTick(() => ioEntries.forEach((e) => ioCallback([e])))
  }

  function setupIO(scrollEl: HTMLElement) {
    io?.disconnect()
    io = new IntersectionObserver(ioCallback, { root: scrollEl, rootMargin: '300px', threshold: 0 })
    nextTick(() => scrollEl.querySelectorAll('[data-pages]').forEach((el) => io!.observe(el)))
  }

  // Call when a new document is loaded to clear stale canvas/text-layer refs.
  function reset() {
    canvasMap.value = new Map()
    textLayerMap.value = new Map()
    rendered.clear()
    renderQueue = []
    isRendering = false
  }

  function destroy() {
    io?.disconnect()
  }

  return { canvasMap, textLayerMap, invalidate, setupIO, reset, destroy }
}
