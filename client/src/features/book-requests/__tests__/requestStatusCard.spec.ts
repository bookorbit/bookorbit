// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookRequestDownloadItem, BookRequestItem, BookRequestReview } from '@bookorbit/types'
import { requestCardModel, UNREADABLE_FILES_CODE, type RequestCardInput } from '../requestStatusCard'

/** Echoes the key and its parameters, so a test reads which message was picked and with what. */
function t(key: string, named?: Record<string, unknown>): string {
  return named ? `${key} ${JSON.stringify(named)}` : key
}

const DOWNLOAD = {
  id: 11,
  status: 'downloading',
  progressPercent: 42.4,
  downloadedBytes: 400,
  totalBytes: 1000,
  downloadClientName: 'qBittorrent',
  completedAt: null,
} as BookRequestDownloadItem

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 7,
    title: 'The Left Hand of Darkness',
    requesterName: 'Maya Ortiz',
    mediaKind: 'ebook',
    status: 'pending',
    download: null,
    statusReason: null,
    failureCode: null,
    failureMeta: null,
    targetLibraryName: 'Fiction',
    updatedAt: '2026-11-16T09:00:00.000Z',
    ...overrides,
  } as BookRequestItem
}

function model(overrides: Partial<RequestCardInput> = {}) {
  return requestCardModel({
    request: request(),
    live: null,
    review: null,
    canDecide: true,
    seeding: null,
    t,
    formatBytes: (bytes) => `${bytes} B`,
    relativeTime: () => '14 minutes ago',
    ...overrides,
  })
}

describe('requestCardModel', () => {
  it('tells whoever decides what to do with a waiting request, and nobody else', () => {
    const decider = model()
    const requester = model({ canDecide: false })

    expect(decider.headline).toBe('bookRequests.outcome.awaitingApproval')
    expect(decider.sentence).toBe('bookRequests.statusCard.pendingDecide.ebook {"requester":"Maya Ortiz"}')
    expect(decider.tone).toBe('waiting')
    expect(requester.sentence).toBeNull()
  })

  it('carries a transfer as a rounded figure, the bytes so far and the client holding it', () => {
    const card = model({ request: request({ status: 'downloading', download: DOWNLOAD }) })

    expect(card.icon).toBe('download')
    expect(card.percent).toBe(42)
    expect(card.sentence).toBe('bookRequests.statusCard.transferredIn {"done":"400 B","total":"1000 B","client":"qBittorrent"}')
  })

  it('names the hand-back as the reason a request needs a release', () => {
    const card = model({ request: request({ status: 'approved', failureCode: 'AUTOMATION_DISABLED' }) })

    expect(card.headline).toBe('bookRequests.nextStep.needsRelease')
    expect(card.sentence).toBe('bookRequests.handback.AUTOMATION_DISABLED {}')
  })

  it('draws the score of a held import against the threshold it missed', () => {
    const review = {
      bookDockFileId: 100,
      heldOnRequest: false,
      verification: { score: 64, threshold: 80, passed: false, reason: 'below_threshold', rows: [] },
    } as unknown as BookRequestReview
    const card = model({ request: request({ status: 'needs_review' }), review })

    expect(card.score).toEqual({ score: 64, threshold: 80 })
    expect(card.sentence).toContain('bookRequests.review.scoreShort')
  })

  it('names the older edition instead of drawing the score of a file whose title and author matched', () => {
    const review = {
      bookDockFileId: 100,
      heldOnRequest: false,
      verification: { score: 0, threshold: 80, passed: false, reason: 'edition_mismatch', rows: [] },
    } as unknown as BookRequestReview
    const card = model({ request: request({ status: 'needs_review' }), review })

    expect(card.score).toBeNull()
    expect(card.sentence).toBe('bookRequests.review.editionHeld')
  })

  it('says the entry is gone rather than drawing a score for it', () => {
    const review = { bookDockFileId: null, heldOnRequest: false, verification: null } as unknown as BookRequestReview
    const card = model({ request: request({ status: 'needs_review' }), review })

    expect(card.score).toBeNull()
    expect(card.sentence).toBe('bookRequests.review.missingEntry')
  })

  describe('a download whose files could not be read', () => {
    const failed = request({
      status: 'failed',
      download: { ...DOWNLOAD, status: 'failed', completedAt: '2026-11-16T08:00:00.000Z' },
      failureCode: UNREADABLE_FILES_CODE,
      failureMeta: { path: '/downloads/complete/Ursula K. Le Guin - The Left Hand of Darkness' },
    })

    it('puts the path in a block of its own, so it can be copied', () => {
      const card = model({ request: failed })

      expect(card.headline).toBe('bookRequests.statusCard.unreadableTitle')
      expect(card.path).toBe('/downloads/complete/Ursula K. Le Guin - The Left Hand of Darkness')
      expect(card.tone).toBe('failed')
    })

    it('says the client is still seeding it only once that has been read', () => {
      expect(model({ request: failed, seeding: true }).sentence).toContain('bookRequests.statusCard.unreadableSeeding')
      expect(model({ request: failed, seeding: null }).sentence).toContain('bookRequests.statusCard.unreadableClient')
    })

    it('falls back to the ordinary failure line when the server sent no path', () => {
      const card = model({ request: { ...failed, failureMeta: null } })

      expect(card.path).toBeNull()
      expect(card.headline).toContain('bookRequests.pipeline.summary.failed')
    })
  })

  it('names the step an ordinary failure stopped at', () => {
    const card = model({ request: request({ status: 'failed', statusReason: 'Tracker said no' }) })

    expect(card.headline).toContain('bookRequests.pipeline.steps.release')
    expect(card.sentence).toBe('Tracker said no')
  })

  it('says where and when a filed request landed', () => {
    const card = model({ request: request({ status: 'available' }) })

    expect(card.tone).toBe('done')
    expect(card.sentence).toBe('bookRequests.outcome.filedIn {"library":"Fiction","time":"14 minutes ago"}')
  })

  describe('an upload', () => {
    const UPLOAD = {
      ...DOWNLOAD,
      source: 'upload',
      downloadClientName: null,
      uploadedByName: 'Neon',
      uploadFileCount: 39,
      uploadFilesReceived: 16,
    } as BookRequestDownloadItem
    const sending = { here: true, fileCount: 39, doneCount: 16, stalledCount: 0, sentBytes: 251, totalBytes: 612 }

    it('counts files and bytes from the page sending them, and asks it to stay open', () => {
      const card = model({ request: request({ status: 'downloading', download: UPLOAD }), upload: sending })

      expect(card.icon).toBe('upload')
      expect(card.tone).toBe('progress')
      expect(card.headline).toBe('bookRequests.upload.card.uploading {"done":16,"total":39}')
      expect(card.sentence).toBe('bookRequests.upload.card.uploadingHere {"sent":"251 B","size":"612 B","name":"Neon"}')
      expect(card.percent).toBe(41)
    })

    it('names the sender to anyone else watching it arrive', () => {
      const card = model({ request: request({ status: 'downloading', download: UPLOAD }) })

      expect(card.sentence).toBe('bookRequests.upload.card.uploadingElsewhere {"sent":"400 B","size":"1000 B","name":"Neon"}')
      expect(card.percent).toBe(40)
    })

    it('pauses once nothing is moving and a file is still missing', () => {
      const card = model({
        request: request({ status: 'downloading', download: UPLOAD }),
        upload: { ...sending, here: false, doneCount: 38, stalledCount: 1 },
      })

      expect(card.icon).toBe('paused')
      expect(card.tone).toBe('waiting')
      expect(card.headline).toBe('bookRequests.upload.card.paused {"count":1}')
      expect(card.sentence).toBe('bookRequests.upload.card.pausedSentence {"arrived":38,"total":39}')
      expect(card.percent).toBeNull()
    })

    it('says the arrived files are being checked rather than filed', () => {
      const card = model({ request: request({ status: 'importing', download: { ...UPLOAD, status: 'completed' } }) })

      expect(card.icon).toBe('checking')
      expect(card.headline).toBe('bookRequests.upload.card.checking')
      expect(card.sentence).toBe('bookRequests.upload.card.checkingSentence {"total":39}')
    })

    it('says which book it joined, and that the requester was told only to someone else', () => {
      const filed = request({ status: 'available', mediaKind: 'audiobook', targetBookId: 12, download: { ...UPLOAD, status: 'imported' } })

      expect(model({ request: filed }).headline).toBe('bookRequests.upload.card.filedIn {"library":"Fiction"}')
      expect(model({ request: filed }).sentence).toBe(
        'bookRequests.upload.card.joinedTold.audiobook {"title":"The Left Hand of Darkness","requester":"Maya Ortiz"}',
      )
      expect(model({ request: filed, viewerIsRequester: true }).sentence).toBe(
        'bookRequests.upload.card.joined.audiobook {"title":"The Left Hand of Darkness","requester":"Maya Ortiz"}',
      )
      expect(model({ request: { ...filed, targetBookId: null }, viewerIsRequester: true }).sentence).toBeNull()
    })
  })
})
