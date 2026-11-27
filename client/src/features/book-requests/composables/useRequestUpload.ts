import { reactive } from 'vue'
import { BOOK_REQUEST_UPLOAD_MAX_FILES, bookRequestUploadSet, UploadErrorCode } from '@bookorbit/types'
import type {
  BookRequestItem,
  BookRequestUploadManifest,
  BookRequestUploadManifestResponse,
  BookRequestUploadPlan,
  BookRequestUploadPlanFile,
  BookRequestUploadStartResult,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { uploadWithSession, type UploadFailure } from '@/lib/upload-session'
import { fulfilmentBase } from '../fulfilmentBase'
import type { RequestCardUpload } from '../requestStatusCard'
import { baseName, mergePicked, type PickedUploadFile } from '../requestUploadFiles'

/** Three files at a time: enough to keep a fast connection busy, few enough that each one moves. */
const CONCURRENT_FILES = 3

export type RequestUploadFileState = 'waiting' | 'sending' | 'done' | 'failed'

/** Why a file did not arrive, as a key the drawer translates. */
export type RequestUploadFileError = 'connection' | 'notABook' | 'tooLarge' | 'storageFull' | 'notExpected' | 'expired' | 'other'

export interface RequestUploadFile {
  /** The manifest entry, which is also the upload session's target. */
  id: number
  name: string
  /** As the manifest stores it, relative to the picked folder. */
  path: string
  sizeBytes: number
  sentBytes: number
  state: RequestUploadFileState
  error: RequestUploadFileError | null
  /** The picked file, or null when this page never had it or lost it to a reload. */
  file: File | null
}

export type RequestUploadPlanError = 'tooMany' | 'refused' | 'network'

export interface RequestUploadState {
  requestId: number
  picked: PickedUploadFile[]
  plan: BookRequestUploadPlan | null
  planning: boolean
  planError: RequestUploadPlanError | null
  /** The server's own sentence when it refused, which no catalog has a key for. */
  planReason: string | null
  /** Which book goes, for a plan that offers a choice. */
  chosenUnit: number | null
  holdForReview: boolean
  starting: boolean
  /** Set once the attempt exists; the files below are its manifest. */
  downloadId: number | null
  files: RequestUploadFile[]
}

export type RequestUploadStartOutcome = { ok: true; request: BookRequestItem } | { ok: false; reason: string | null }

/**
 * Shared by every drawer, so an upload keeps going while its drawer steps to another request and
 * the drawer that comes back to it finds it where it was.
 */
const states = reactive(new Map<number, RequestUploadState>())
const controllers = new Map<number, AbortController>()
/** The newest plan asked for each request, so an older answer arriving late is dropped. */
const planSequences = new Map<number, number>()

function blankState(requestId: number): RequestUploadState {
  return {
    requestId,
    picked: [],
    plan: null,
    planning: false,
    planError: null,
    planReason: null,
    chosenUnit: null,
    holdForReview: false,
    starting: false,
    downloadId: null,
    files: [],
  }
}

function ensure(requestId: number): RequestUploadState {
  let state = states.get(requestId)
  if (!state) {
    states.set(requestId, blankState(requestId))
    state = states.get(requestId)!
  }
  return state
}

/** Whether this page still has bytes to send for some request. Closing the tab would strand them. */
export function hasUnsentRequestUploads(): boolean {
  for (const state of states.values()) {
    if (state.files.some((file) => file.file !== null && (file.state === 'waiting' || file.state === 'sending'))) return true
  }
  return false
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsentRequestUploads()) return
    event.preventDefault()
  })
}

/** The files the plan sends, given the book chosen where a choice was needed. */
export function plannedUploadFiles(state: Pick<RequestUploadState, 'plan' | 'chosenUnit'>): BookRequestUploadPlanFile[] {
  const plan = state.plan
  if (!plan) return []
  return bookRequestUploadSet(plan.files, plan.status, plan.status === 'choose' ? state.chosenUnit : plan.selectedUnitIndex)
}

/** What the status card says of an upload this page started or came back to. */
export function requestUploadSummary(state: RequestUploadState | null): RequestCardUpload | null {
  if (!state || state.downloadId === null) return null
  let doneCount = 0
  let stalledCount = 0
  let sentBytes = 0
  let totalBytes = 0
  let here = false
  for (const file of state.files) {
    if (file.state === 'done') doneCount++
    if (file.state === 'failed') stalledCount++
    if (file.state === 'waiting' || file.state === 'sending') here = true
    sentBytes += file.state === 'done' ? file.sizeBytes : file.sentBytes
    totalBytes += file.sizeBytes
  }
  return { here, fileCount: state.files.length, doneCount, stalledCount, sentBytes, totalBytes }
}

function releasePathOf(plan: BookRequestUploadPlan, path: string): string {
  return plan.rootName ? path.slice(plan.rootName.length + 1) : path
}

function errorOf(failure: UploadFailure): RequestUploadFileError {
  if (failure.kind === 'network') return 'connection'
  switch (failure.errorCode) {
    case UploadErrorCode.InvalidContent:
    case UploadErrorCode.UnsupportedFormat:
      return 'notABook'
    case UploadErrorCode.TooLarge:
      return 'tooLarge'
    case UploadErrorCode.StorageFull:
      return 'storageFull'
    case UploadErrorCode.InvalidTarget:
      return 'notExpected'
    case UploadErrorCode.SessionExpired:
      return 'expired'
    default:
      return failure.status >= 500 && !failure.fromBookOrbit ? 'connection' : 'other'
  }
}

export function useRequestUpload(canManage: () => boolean) {
  const base = () => fulfilmentBase(canManage())

  function stateFor(requestId: number): RequestUploadState | null {
    return states.get(requestId) ?? null
  }

  /** Files picked or dropped; added to what is already there, then read by the server. */
  async function pick(requestId: number, added: PickedUploadFile[], options: { append?: boolean } = {}): Promise<void> {
    const state = ensure(requestId)
    if (state.downloadId !== null) return
    state.picked = options.append ? mergePicked(state.picked, added) : added
    await replan(state)
  }

  async function replan(state: RequestUploadState): Promise<void> {
    state.plan = null
    state.planError = null
    state.planReason = null
    state.chosenUnit = null
    if (state.picked.length === 0) return
    if (state.picked.length > BOOK_REQUEST_UPLOAD_MAX_FILES) {
      state.planError = 'tooMany'
      return
    }

    const sequence = (planSequences.get(state.requestId) ?? 0) + 1
    planSequences.set(state.requestId, sequence)
    const current = () => planSequences.get(state.requestId) === sequence
    state.planning = true
    try {
      const res = await api(`${base()}/${state.requestId}/upload/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: state.picked.map((entry) => ({ path: entry.path, sizeBytes: entry.file.size })) }),
      })
      // A newer pick replaced these files while the server was reading them.
      if (!current()) return
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
        const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message
        state.planError = 'refused'
        state.planReason = message?.trim() || null
        return
      }
      const plan = (await res.json()) as BookRequestUploadPlan
      if (!current()) return
      state.plan = plan
      state.chosenUnit = plan.status === 'choose' ? plan.selectedUnitIndex : null
    } catch {
      if (current()) state.planError = 'network'
    } finally {
      if (current()) state.planning = false
    }
  }

  function chooseUnit(requestId: number, unitIndex: number) {
    const state = states.get(requestId)
    if (state && state.downloadId === null) state.chosenUnit = unitIndex
  }

  function setHold(requestId: number, hold: boolean) {
    const state = states.get(requestId)
    if (state) state.holdForReview = hold
  }

  function removePicked(requestId: number, path: string) {
    const state = states.get(requestId)
    if (!state || state.downloadId !== null) return
    state.picked = state.picked.filter((entry) => entry.path !== path)
    void replan(state)
  }

  /** Forgets whatever this page knows about the request's upload. Nothing on the server changes. */
  function clear(requestId: number) {
    controllers.get(requestId)?.abort()
    controllers.delete(requestId)
    states.delete(requestId)
  }

  /** Starts the attempt, then sends its files. Resolves once the attempt exists, not once it is sent. */
  async function start(requestId: number): Promise<RequestUploadStartOutcome> {
    const state = states.get(requestId)
    if (!state?.plan || state.starting) return { ok: false, reason: null }
    const plan = state.plan
    const sending = plannedUploadFiles(state)
    if (sending.length === 0) return { ok: false, reason: null }

    const byPath = new Map(state.picked.map((entry, index) => [plan.files[index]?.path ?? entry.path, entry.file]))
    state.starting = true
    try {
      const res = await api(`${base()}/${requestId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: sending.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })), holdForReview: state.holdForReview }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
        const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message
        return { ok: false, reason: message?.trim() || null }
      }
      const result = (await res.json()) as BookRequestUploadStartResult
      const fileFor = new Map(sending.map((file) => [releasePathOf(plan, file.path), byPath.get(file.path) ?? null]))
      adoptManifest(state, result.upload, (entry) => fileFor.get(entry.path) ?? null)
      drive(state)
      return { ok: true, request: result.request }
    } catch {
      return { ok: false, reason: null }
    } finally {
      state.starting = false
    }
  }

  function adoptManifest(
    state: RequestUploadState,
    manifest: BookRequestUploadManifest,
    fileFor: (entry: BookRequestUploadManifest['files'][number]) => File | null,
  ) {
    state.downloadId = manifest.downloadId
    state.files = manifest.files.map((entry) => ({
      id: entry.id,
      name: baseName(entry.path),
      path: entry.path,
      sizeBytes: entry.sizeBytes,
      sentBytes: entry.receivedBytes,
      state: entry.status === 'received' ? 'done' : 'waiting',
      error: null,
      file: entry.status === 'received' ? null : fileFor(entry),
    }))
    // A file this page cannot send is not waiting on it; it waits on being picked again.
    for (const file of state.files) {
      if (file.state === 'waiting' && file.file === null) file.state = 'failed'
    }
  }

  /** Reads back an upload this page lost track of, so it can be finished or cancelled. */
  async function load(requestId: number): Promise<BookRequestUploadManifest | null> {
    const res = await api(`${base()}/${requestId}/upload`).catch(() => null)
    if (!res?.ok) return null
    const body = (await res.json().catch(() => null)) as BookRequestUploadManifestResponse | null
    const manifest = body?.upload ?? null
    const state = states.get(requestId)
    if (manifest && (!state || state.downloadId !== manifest.downloadId)) {
      const fresh = blankState(requestId)
      states.set(requestId, fresh)
      adoptManifest(states.get(requestId)!, manifest, () => null)
    }
    return manifest
  }

  /**
   * Matches freshly picked files to the ones the upload still waits for, by name and size, and
   * sends them. Answers how many it matched, so the drawer can say when none of them were wanted.
   */
  function resume(requestId: number, picked: PickedUploadFile[]): number {
    const state = states.get(requestId)
    if (!state || state.downloadId === null) return 0
    let matched = 0
    for (const file of state.files) {
      if (file.state === 'done') continue
      const candidate =
        picked.find((entry) => entry.file.size === file.sizeBytes && entry.path.endsWith(file.path)) ??
        picked.find((entry) => entry.file.size === file.sizeBytes && baseName(entry.path) === file.name)
      if (!candidate) continue
      file.file = candidate.file
      file.state = 'waiting'
      file.error = null
      matched++
    }
    if (matched > 0) drive(state)
    return matched
  }

  /** Sends again every file that failed, carrying on from what the server already holds. */
  function retry(requestId: number, fileId?: number) {
    const state = states.get(requestId)
    if (!state) return
    for (const file of state.files) {
      if (file.state !== 'failed' || file.file === null || (fileId !== undefined && file.id !== fileId)) continue
      file.state = 'waiting'
      file.error = null
    }
    drive(state)
  }

  /** Stops sending. The attempt itself is cancelled through the request, which ends the sessions. */
  function stop(requestId: number) {
    controllers.get(requestId)?.abort()
    controllers.delete(requestId)
  }

  function drive(state: RequestUploadState) {
    let controller = controllers.get(state.requestId)
    if (!controller || controller.signal.aborted) {
      controller = new AbortController()
      controllers.set(state.requestId, controller)
    }
    const signal = controller.signal
    const downloadId = state.downloadId
    if (downloadId === null) return

    const next = () => {
      if (signal.aborted) return
      while (state.files.filter((file) => file.state === 'sending').length < CONCURRENT_FILES) {
        const file = state.files.find((candidate) => candidate.state === 'waiting' && candidate.file !== null)
        if (!file) return
        file.state = 'sending'
        void send(file, downloadId, signal).then(next)
      }
    }
    next()
  }

  async function send(file: RequestUploadFile, downloadId: number, signal: AbortSignal): Promise<void> {
    const outcome = await uploadWithSession({
      file: file.file!,
      filename: file.name,
      target: { kind: 'book_request', requestFileId: file.id },
      resumeKey: `request-upload.${downloadId}.${file.id}`,
      signal,
      onProgress: (fraction) => {
        file.sentBytes = Math.round(fraction * file.sizeBytes)
      },
    })
    if (signal.aborted) return
    if (outcome.ok) {
      file.state = 'done'
      file.sentBytes = file.sizeBytes
      file.file = null
      return
    }
    file.state = 'failed'
    file.error = errorOf(outcome.failure)
  }

  return { stateFor, pick, chooseUnit, setHold, removePicked, clear, start, load, resume, retry, stop }
}
