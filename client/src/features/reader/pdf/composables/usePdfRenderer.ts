import { nextTick, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { CancellableRender, PageDim } from './usePdf'

interface PdfTextItem {
  str: string
  transform: number[]
  height?: number
}

interface PdfViewport {
  width: number
  height: number
  clone(opts: { scale: number; rotation: number }): PdfViewport
}

interface PdfTextContent {
  items: unknown[]
}

type StartRenderPageFn = (pageNum: number, canvas: HTMLCanvasElement, scale: number) => CancellableRender
type GetTextContentFn = (pageNum: number) => Promise<{ content: PdfTextContent; viewport: PdfViewport } | null>
type OnDimUpdateFn = (pageNum: number, dim: PageDim) => void

export function usePdfRenderer(
  startRenderPageFn: StartRenderPageFn,
  getTextContentFn: GetTextContentFn,
  scale: ComputedRef<number>,
  totalPages: Ref<number>,
  onDimUpdate: OnDimUpdateFn,
) {
  const canvasMap = ref(new Map<number, HTMLCanvasElement>())
  const textLayerMap = ref(new Map<number, HTMLElement>())

  const rendered = new Set<number>()
  // Tracks in-flight renders so they can be cancelled before a new one starts on the same canvas.
  const activeRenders = new Map<number, CancellableRender>()
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

      // Cancel any prior render on this canvas before starting a new one.
      activeRenders.get(pageNum)?.cancel()

      const task = startRenderPageFn(pageNum, canvas, scale.value)
      activeRenders.set(pageNum, task)
      await task.promise

      // Only proceed with post-render steps if this task wasn't superseded.
      if (activeRenders.get(pageNum) !== task) continue
      activeRenders.delete(pageNum)

      const dpr = window.devicePixelRatio || 1
      onDimUpdate(pageNum, { width: canvas.width / (scale.value * dpr), height: canvas.height / (scale.value * dpr) })
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
    const scaledVp = viewport.clone({ scale: scale.value, rotation: 0 })
    container.innerHTML = ''
    container.style.width = `${scaledVp.width}px`
    container.style.height = `${scaledVp.height}px`
    const s = scale.value
    for (const item of content.items) {
      if (typeof item !== 'object' || item === null || !('str' in item)) continue
      const { str, transform, height } = item as PdfTextItem
      if (!str.trim()) continue
      const [a, b, , , e, f] = transform as [number, number, number, number, number, number]
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
    // Cancel all in-flight renders so their canvases are free immediately.
    for (const task of activeRenders.values()) task.cancel()
    activeRenders.clear()
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
    for (const task of activeRenders.values()) task.cancel()
    activeRenders.clear()
    canvasMap.value = new Map()
    textLayerMap.value = new Map()
    rendered.clear()
    renderQueue = []
    isRendering = false
  }

  function destroy() {
    io?.disconnect()
    for (const task of activeRenders.values()) task.cancel()
  }

  return { canvasMap, textLayerMap, invalidate, setupIO, reset, destroy }
}
