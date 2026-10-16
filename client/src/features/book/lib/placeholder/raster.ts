import { reactive } from 'vue'
import type { RasterRequest } from './svg'

// Marbled and Riso paint their artwork on a canvas, which costs a few to twenty milliseconds per
// cover. Jobs run in idle time a slice at a time, so scrolling a grid of new covers never blocks
// on them, and finished bitmaps are kept as object URLs in a bounded LRU.

const LIMIT = 240
const SLICE_MS = 10

const ready = reactive(new Map<string, string>())
const order: string[] = []
const queued = new Set<string>()
const jobs: RasterRequest[] = []
let scheduled = false

type IdleCallback = (cb: () => void) => void
const whenIdle: IdleCallback = (cb) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(cb, { timeout: 250 })
  else setTimeout(cb, 16)
}

function evict() {
  while (order.length > LIMIT) {
    const key = order.shift()
    if (!key) break
    const url = ready.get(key)
    ready.delete(key)
    queued.delete(key)
    if (url) URL.revokeObjectURL(url)
  }
}

function paint(job: RasterRequest) {
  const canvas = document.createElement('canvas')
  canvas.width = job.width
  canvas.height = job.height
  const g = canvas.getContext('2d')
  if (!g) return
  job.draw(g)
  canvas.toBlob(
    (blob) => {
      if (!blob) return
      ready.set(job.key, URL.createObjectURL(blob))
      order.push(job.key)
      evict()
    },
    'image/jpeg',
    0.9,
  )
}

function run() {
  scheduled = false
  const start = performance.now()
  do {
    const job = jobs.shift()
    if (!job) break
    paint(job)
  } while (jobs.length && performance.now() - start < SLICE_MS)
  if (jobs.length) schedule()
}

function schedule() {
  if (scheduled) return
  scheduled = true
  whenIdle(run)
}

export function requestRaster(request: RasterRequest): string | null {
  const url = ready.get(request.key)
  if (url) return url
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  if (!queued.has(request.key)) {
    queued.add(request.key)
    jobs.push(request)
    schedule()
  }
  return null
}

/** Pixel width for a bitmap drawn at `px` CSS pixels, bucketed so nearby sizes share one image. */
export function rasterWidth(px: number): number {
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)
  return Math.max(64, Math.min(720, Math.ceil((px * dpr) / 32) * 32))
}
