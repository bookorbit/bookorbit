import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRequestDownloadItem, BookRequestItem } from '@bookorbit/types'

const api = vi.fn<(input: string) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (...args: [string]) => api(...args) }))

import RequestAttemptsPanel from '../components/RequestAttemptsPanel.vue'

function attempt(overrides: Partial<BookRequestDownloadItem> = {}): BookRequestDownloadItem {
  return {
    id: 12,
    requestId: 7,
    downloadClientId: null,
    downloadClientName: null,
    downloadClientColor: null,
    source: 'torrent_file',
    indexerId: 1,
    indexerName: 'MyAnonaMouse',
    indexerColor: null,
    automated: true,
    releaseTitle: 'Stalked by Seduction and Shadows [EPUB]',
    releaseSizeBytes: 2_300_000,
    clientHash: null,
    status: 'failed',
    progressPercent: 0,
    downloadedBytes: 0,
    totalBytes: null,
    errorMessage: 'MyAnonaMouse: the tracker answered 406: Download blocked: VIP torrent',
    grabbedAt: '2026-08-20T17:41:38.000Z',
    completedAt: null,
    importedAt: null,
    releaseUnits: null,
    createdAt: '2026-08-20T17:41:38.000Z',
    ...overrides,
  }
}

const CURRENT = attempt({
  id: 13,
  indexerId: 2,
  indexerName: 'Library Genesis',
  source: 'direct_url',
  clientHash: 'a'.repeat(40),
  status: 'imported',
  errorMessage: null,
})

function request(download: BookRequestDownloadItem | null): BookRequestItem {
  return { id: 7, status: 'available', download } as BookRequestItem
}

async function render(attempts: BookRequestDownloadItem[], download: BookRequestDownloadItem | null = CURRENT) {
  api.mockResolvedValue({ ok: true, json: () => Promise.resolve(attempts) } as Response)
  const wrapper = mount(RequestAttemptsPanel, { props: { request: request(download), canManage: true } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.mockReset()
})

describe('RequestAttemptsPanel', () => {
  /**
   * The question this answers: the book arrived from Library Genesis, and nothing on the request
   * said the tracker had been asked first and had refused.
   */
  it('shows the release a source refused before the one that worked', async () => {
    const text = (await render([CURRENT, attempt()])).text()

    expect(text).toContain('MyAnonaMouse')
    expect(text).toContain('the tracker answered 406')
  })

  /** Nothing was downloaded, so "Download failed" would describe something that never happened. */
  it('calls an attempt that never reached a client refused rather than failed', async () => {
    const text = (await render([CURRENT, attempt()])).text()

    expect(text).toContain('Refused, nothing downloaded')
    expect(text).not.toContain('Download failed')
  })

  /** The transfer section above is already showing it; saying it twice is not history. */
  it('leaves out the attempt the request is already showing', async () => {
    const text = (await render([CURRENT])).text()

    expect(text).not.toContain('Library Genesis')
  })

  it('renders nothing at all when a request has only ever made one attempt', async () => {
    const wrapper = await render([CURRENT])

    expect(wrapper.find('section').exists()).toBe(false)
  })
})
