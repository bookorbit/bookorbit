// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookRequestDownloadItem, BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'
import { requestOutcome } from '../requestOutcome'

const TIME = 'just now'
const formatTime = () => TIME

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 1,
    status: 'pending',
    dismissed: false,
    download: null,
    targetLibraryName: null,
    updatedAt: '2026-08-19T10:00:00.000Z',
    ...overrides,
  } as BookRequestItem
}

function download(status: BookRequestDownloadItem['status']): BookRequestDownloadItem {
  return { id: 7, status } as BookRequestDownloadItem
}

describe('requestOutcome', () => {
  it('reports a live transfer over anything the status would say', () => {
    const row = request({ status: 'downloading', download: download('downloading') })

    expect(requestOutcome(row, null, formatTime)).toEqual({ kind: 'progress', key: null })
  })

  it('keeps a later fetched download state over an older live tick', () => {
    const row = request({ status: 'grabbed', download: download('completed') })
    const live: BookRequestProgressEvent = {
      requestId: 1,
      downloadId: 7,
      status: 'downloading',
      progressPercent: 12,
      downloadedBytes: 12,
      totalBytes: 100,
    }

    expect(requestOutcome(row, live, formatTime).kind).toBe('waiting')
  })

  it('leaves the body to the caller on a failure, since the reason is the tracker prose', () => {
    const row = request({ status: 'failed', statusReason: 'Tracker said no' })

    expect(requestOutcome(row, null, formatTime)).toEqual({ kind: 'failure', key: null })
  })

  it('names the library a finished request landed in', () => {
    const row = request({ status: 'available', targetLibraryName: 'Novels' })

    expect(requestOutcome(row, null, formatTime)).toEqual({
      kind: 'settled',
      key: 'filedIn',
      params: { library: 'Novels', time: TIME },
    })
  })

  it('falls back to the bare time when a finished request has no library on it', () => {
    const row = request({ status: 'available' })

    expect(requestOutcome(row, null, formatTime)).toEqual({ kind: 'settled', key: 'filed', params: { time: TIME } })
  })

  it.each([
    ['rejected', 'rejected'],
    ['cancelled', 'cancelled'],
  ] as const)('reports %s as settled', (status, key) => {
    expect(requestOutcome(request({ status }), null, formatTime)).toEqual({ kind: 'settled', key, params: { time: TIME } })
  })

  it.each([
    ['pending', 'awaitingApproval'],
    ['needs_review', 'awaitingReview'],
  ] as const)('reports %s as waiting on a person', (status, key) => {
    expect(requestOutcome(request({ status }), null, formatTime)).toEqual({ kind: 'waiting', key })
  })

  it.each([
    ['approved', 'atStage.release'],
    ['searching', 'atStage.release'],
    ['grabbed', 'atStage.downloading'],
    ['importing', 'atStage.filed'],
  ] as const)('names the stage %s is sitting on when nothing is transferring', (status, key) => {
    expect(requestOutcome(request({ status }), null, formatTime)).toEqual({ kind: 'waiting', key })
  })

  it('does not claim progress for a download that already finished transferring', () => {
    const row = request({ status: 'importing', download: download('completed') })

    expect(requestOutcome(row, null, formatTime).kind).toBe('waiting')
  })
})
