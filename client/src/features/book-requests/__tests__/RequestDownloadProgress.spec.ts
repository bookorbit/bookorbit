import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookRequestDownloadItem, BookRequestProgressEvent } from '@bookorbit/types'

import RequestDownloadProgress from '../components/RequestDownloadProgress.vue'

function download(overrides: Partial<BookRequestDownloadItem> = {}): BookRequestDownloadItem {
  return {
    id: 11,
    requestId: 7,
    downloadClientId: 5,
    downloadClientName: 'Direct download',
    downloadClientColor: null,
    source: 'direct_url',
    indexerId: null,
    indexerName: null,
    indexerColor: null,
    automated: false,
    releaseTitle: 'Pride and Prejudice',
    releaseSizeBytes: null,
    clientHash: 'a'.repeat(40),
    status: 'queued',
    progressPercent: 0,
    downloadedBytes: 0,
    totalBytes: null,
    errorMessage: null,
    grabbedAt: null,
    completedAt: null,
    importedAt: null,
    releaseUnits: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('RequestDownloadProgress', () => {
  it('uses source-neutral copy while a direct download is queued', () => {
    const wrapper = mount(RequestDownloadProgress, { props: { download: download(), live: null } })

    expect(wrapper.text()).toContain('Queued for download')
    expect(wrapper.text()).not.toContain('download client')
  })

  it('reports downloaded bytes even when the source supplied no total size', () => {
    const live: BookRequestProgressEvent = {
      requestId: 7,
      downloadId: 11,
      status: 'downloading',
      progressPercent: 0,
      downloadedBytes: 2 * 1024 * 1024,
      totalBytes: null,
    }
    const wrapper = mount(RequestDownloadProgress, { props: { download: download(), live } })

    expect(wrapper.text()).toContain('2 MB downloaded')
  })

  it('keeps a later persisted importing state over a stale completed event', () => {
    const live: BookRequestProgressEvent = {
      requestId: 7,
      downloadId: 11,
      status: 'completed',
      progressPercent: 100,
      downloadedBytes: 10,
      totalBytes: 10,
    }
    const wrapper = mount(RequestDownloadProgress, { props: { download: download({ status: 'importing' }), live } })

    expect(wrapper.text()).toContain('Importing into your library')
    expect(wrapper.text()).not.toContain('Download finished')
  })

  it('ignores a live event from an earlier download attempt', () => {
    const live: BookRequestProgressEvent = {
      requestId: 7,
      downloadId: 10,
      status: 'completed',
      progressPercent: 100,
      downloadedBytes: 10,
      totalBytes: 10,
    }
    const wrapper = mount(RequestDownloadProgress, { props: { download: download({ status: 'downloading' }), live } })

    expect(wrapper.text()).toContain('Downloading')
    expect(wrapper.text()).not.toContain('Download finished')
  })

  /**
   * "Added to your library" says the book arrived and nothing else. Which source served it is the
   * question that comes next, and with a failover in front of it, the answer is not the release
   * the request started with.
   */
  it('names the source the release actually came from', () => {
    const wrapper = mount(RequestDownloadProgress, {
      props: {
        download: download({ indexerName: 'Library Genesis', source: 'direct_url', automated: true, status: 'imported' }),
        live: null,
      },
    })

    expect(wrapper.text()).toContain('Library Genesis')
    expect(wrapper.text()).toContain('Direct download')
    expect(wrapper.text()).toContain('Grabbed automatically')
  })

  it('reuses the configured source and protocol colors for transfer facts', () => {
    const wrapper = mount(RequestDownloadProgress, {
      props: {
        download: download({
          indexerName: 'MAM',
          indexerColor: 'orange',
          source: 'magnet',
          downloadClientName: 'qBittorrent',
          downloadClientColor: 'green',
        }),
        live: null,
      },
    })

    const pills = wrapper.findAll('.rounded-full.border')
    expect(pills[0]?.classes().join(' ')).toContain('--pill-source-orange')
    expect(pills[1]?.classes().join(' ')).toContain('--pill-torrent')
    expect(pills[2]?.classes().join(' ')).toContain('--pill-source-green')
  })

  it('says a hand-pasted magnet came from no source rather than leaving a gap', () => {
    const wrapper = mount(RequestDownloadProgress, {
      props: { download: download({ indexerName: null, source: 'magnet', automated: false }), live: null },
    })

    expect(wrapper.text()).toContain('Pasted by hand')
    expect(wrapper.text()).toContain('Picked by an approver')
  })

  it('offers an authorized recovery action beside a failed transfer', async () => {
    const wrapper = mount(RequestDownloadProgress, {
      props: { download: download({ status: 'failed', errorMessage: 'No seeds' }), live: null, canRetry: true },
    })

    const retry = wrapper.get('button')
    expect(retry.text()).toBe('Try another release')

    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('does not offer recovery without fulfilment permission', () => {
    const wrapper = mount(RequestDownloadProgress, {
      props: { download: download({ status: 'failed', errorMessage: 'No seeds' }), live: null },
    })

    expect(wrapper.find('button').exists()).toBe(false)
  })
})
