import { computed, readonly, ref } from 'vue'
import type { JobsSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import { listenToJobs } from '../lib/jobs-socket'

/** Status changes arrive one event per type a second; a single read covers the whole burst. */
export const JOBS_SUMMARY_REFRESH_MS = 2_000
/** While the socket is down nothing says what changed, so the summary is read on this timer instead. */
export const JOBS_SUMMARY_POLL_MS = 60_000

const summary = ref<JobsSummary | null>(null)
let followers = 0
let stopListening: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let reading = false
let readAgain = false
/** Bumped when following stops, so a read already on the wire cannot bring back a stale summary. */
let generation = 0

async function read(): Promise<void> {
  if (reading) {
    readAgain = true
    return
  }
  reading = true
  const started = generation
  try {
    const res = await api('/api/v1/jobs/summary')
    if (res.ok && started === generation) summary.value = (await res.json()) as JobsSummary
  } catch {
    // Best effort: the next change or poll reads it again.
  } finally {
    reading = false
    if (readAgain && started === generation) {
      readAgain = false
      schedule()
    }
  }
}

function schedule(delay = JOBS_SUMMARY_REFRESH_MS): void {
  if (refreshTimer) {
    if (delay > 0) return
    clearTimeout(refreshTimer)
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void read()
  }, delay)
}

function setPolling(on: boolean): void {
  if (on && !pollTimer) pollTimer = setInterval(() => schedule(0), JOBS_SUMMARY_POLL_MS)
  if (!on && pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function stopAll(): void {
  stopListening?.()
  stopListening = null
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  setPolling(false)
  generation += 1
  readAgain = false
  summary.value = null
}

/**
 * Keeps the summary current until the returned function is called. Only a job changing status
 * re-reads it; progress never does. Callers share one reading and one socket.
 */
export function followJobsSummary(): () => void {
  followers += 1
  if (followers === 1) {
    // Polls until the socket says it is live, so a socket that never connects still leaves a summary.
    setPolling(true)
    stopListening = listenToJobs({
      changed: (event) => {
        if (event.state) schedule()
      },
      live: (live) => {
        setPolling(!live)
        if (live) schedule(0)
      },
    })
    schedule(0)
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    followers -= 1
    if (followers === 0) stopAll()
  }
}

/** The viewer's own jobs at a glance; null while nothing follows it or before the first read. */
export function useJobsSummary() {
  return { summary: readonly(summary) }
}

/** How many of the viewer's jobs wait on them; 0 while the summary is not followed. */
export function useJobsNeedsYou() {
  return computed(() => summary.value?.needsYou ?? 0)
}
