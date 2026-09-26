import { ref } from 'vue'
import type { PodcastImportProgressEvent } from '@bookorbit/types'
import { usePodcastEvents } from './usePodcastEvents'

/** How long a finished import stays on screen so the run does not just vanish mid-glance. */
const SETTLE_MS = 3_000
/**
 * Width of the bar while the run is still counting what it will do. A sliver that means "started"
 * reads better than an empty track, which is indistinguishable from stuck.
 */
const INDETERMINATE_WIDTH = '30%'

export interface PodcastImportState {
  libraryId: number
  processed: number
  total: number | null
  failed: number
  /** True while jobs are queued or running; false during the brief settle after the last one. */
  active: boolean
}

const states = ref<Map<number, PodcastImportState>>(new Map())
const settleTimers = new Map<number, ReturnType<typeof setTimeout>>()
let listening = false

function clearSettle(libraryId: number): void {
  const timer = settleTimers.get(libraryId)
  if (!timer) return
  clearTimeout(timer)
  settleTimers.delete(libraryId)
}

function apply(event: PodcastImportProgressEvent): void {
  const busy = event.queued + event.processing > 0
  const next = new Map(states.value)
  next.set(event.libraryId, {
    libraryId: event.libraryId,
    processed: event.processed,
    total: event.total,
    failed: event.failed,
    active: busy,
  })
  states.value = next

  clearSettle(event.libraryId)
  if (busy) return
  // Nothing is left to do, so the readout has said all it will. It stays up briefly and then goes,
  // the same way a finished book scan does, rather than lingering as a permanent 100%.
  settleTimers.set(
    event.libraryId,
    setTimeout(() => {
      settleTimers.delete(event.libraryId)
      const pending = new Map(states.value)
      pending.delete(event.libraryId)
      states.value = pending
    }, SETTLE_MS),
  )
}

/**
 * Import progress for podcast libraries, shaped the way the book scan readout is so the sidebar and
 * the library view can render the two the same way.
 *
 * State is module-level and the socket listener is registered once, because several components read
 * the same run at the same time and each must not open its own subscription.
 */
export function usePodcastImportProgress() {
  const events = usePodcastEvents()

  if (!listening) {
    listening = true
    // Only the local-file lane belongs here. OPML import has its own readout in the library view,
    // and counting the two together would report a total that describes neither.
    events.onImportProgress((event) => {
      if (event.kind === 'local_files') apply(event)
    })
  }

  function getImport(libraryId: number): PodcastImportState | null {
    return states.value.get(libraryId) ?? null
  }

  function isImporting(libraryId: number): boolean {
    return getImport(libraryId)?.active === true
  }

  function importPct(libraryId: number): number {
    const state = getImport(libraryId)
    if (!state?.total) return 0
    return Math.min(100, Math.floor((state.processed / state.total) * 100))
  }

  function importBarWidth(libraryId: number): string {
    const state = getImport(libraryId)
    return state?.total ? `${importPct(libraryId)}%` : INDETERMINATE_WIDTH
  }

  return {
    subscribeLibrary: events.subscribeLibrary,
    onShowDiscovered: events.onShowDiscovered,
    getImport,
    isImporting,
    importPct,
    importBarWidth,
  }
}
