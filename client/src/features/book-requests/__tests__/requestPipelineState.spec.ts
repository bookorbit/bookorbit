// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BOOK_REQUEST_STATUSES } from '@bookorbit/types'
import type { BookRequestDownloadItem, BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'
import { REQUEST_PIPELINE_STEPS, requestPipelineState, requestPresentationStatus, requestStepState } from '../requestPipeline'

type PipelineInput = Pick<BookRequestItem, 'status' | 'download'>

const DOWNLOAD = { id: 7 } as BookRequestDownloadItem

function progress(downloadId: number, status: BookRequestProgressEvent['status']): BookRequestProgressEvent {
  return { requestId: 1, downloadId, status, progressPercent: 100, downloadedBytes: 10, totalBytes: 10 }
}

function at(status: BookRequestItem['status'], download: BookRequestItem['download'] = null): PipelineInput {
  return { status, download }
}

describe('requestPipelineState', () => {
  it('resolves a stage for every status the server can send', () => {
    const resolved = BOOK_REQUEST_STATUSES.map((status) => ({ status, state: requestPipelineState(at(status)) }))

    for (const { state } of resolved) {
      expect(state.currentIndex).toBeGreaterThanOrEqual(0)
      expect(state.currentIndex).toBeLessThan(REQUEST_PIPELINE_STEPS.length)
    }
    expect(resolved).toHaveLength(BOOK_REQUEST_STATUSES.length)
  })

  it('collapses the two statuses that mean "looking for a release" onto one stage', () => {
    expect(requestPipelineState(at('approved')).currentIndex).toBe(requestPipelineState(at('searching')).currentIndex)
  })

  it('collapses the two statuses that mean "the client has it" onto one stage', () => {
    expect(requestPipelineState(at('grabbed')).currentIndex).toBe(requestPipelineState(at('downloading')).currentIndex)
  })

  it('separates a failure in transfer from a failure to find anything to transfer', () => {
    const inTransfer = requestPipelineState(at('failed', DOWNLOAD))
    const neverFound = requestPipelineState(at('failed'))

    expect(REQUEST_PIPELINE_STEPS[inTransfer.currentIndex]).toBe('downloading')
    expect(REQUEST_PIPELINE_STEPS[neverFound.currentIndex]).toBe('release')
    expect(inTransfer.tone).toBe('failed')
    expect(inTransfer.halted).toBe(true)
  })

  it('places a cancellation where the request had actually reached', () => {
    expect(REQUEST_PIPELINE_STEPS[requestPipelineState(at('cancelled')).currentIndex]).toBe('approved')
    expect(REQUEST_PIPELINE_STEPS[requestPipelineState(at('cancelled', DOWNLOAD)).currentIndex]).toBe('downloading')
  })

  it('marks a pending request as waiting on someone rather than in progress', () => {
    expect(requestPipelineState(at('pending')).tone).toBe('waiting')
    expect(requestPipelineState(at('needs_review')).tone).toBe('waiting')
    expect(requestPipelineState(at('downloading')).tone).toBe('progress')
  })

  it('halts only the statuses that never move again', () => {
    const halted = BOOK_REQUEST_STATUSES.filter((status) => requestPipelineState(at(status)).halted)
    expect([...halted].sort()).toEqual(['cancelled', 'failed', 'rejected'])
  })

  it('moves a completed live transfer to filing while the request row catches up', () => {
    const state = requestPipelineState(at('downloading', { ...DOWNLOAD, status: 'downloading' }), progress(7, 'completed'))

    expect(REQUEST_PIPELINE_STEPS[state.currentIndex]).toBe('filed')
    expect(state.tone).toBe('progress')
  })

  it('ignores live progress from an earlier download attempt', () => {
    const row = at('downloading', { ...DOWNLOAD, status: 'downloading' })

    expect(requestPresentationStatus(row, progress(6, 'completed'))).toBe('downloading')
  })

  it('does not regress a persisted terminal request with stale live progress', () => {
    const row = at('available', { ...DOWNLOAD, status: 'imported' })

    expect(requestPresentationStatus(row, progress(7, 'downloading'))).toBe('available')
  })
})

describe('requestStepState', () => {
  it('fills every step once the book is filed', () => {
    const state = requestPipelineState(at('available'))
    expect(REQUEST_PIPELINE_STEPS.map((_, index) => requestStepState(state, index))).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('lights the current step and leaves the rest hollow', () => {
    const state = requestPipelineState(at('downloading'))
    expect(REQUEST_PIPELINE_STEPS.map((_, index) => requestStepState(state, index))).toEqual(['done', 'done', 'done', 'current', 'upcoming'])
  })

  it('lights the step a failure died on rather than the end of the line', () => {
    const state = requestPipelineState(at('failed'))
    expect(REQUEST_PIPELINE_STEPS.map((_, index) => requestStepState(state, index))).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming'])
  })
})
