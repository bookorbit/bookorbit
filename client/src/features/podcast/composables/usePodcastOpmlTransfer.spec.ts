import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PODCAST_OPML_OMITTED_HEADER } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastOpmlTransfer } from './usePodcastOpmlTransfer'

const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>(), info: vi.fn<() => void>() }))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: unknown) => (params ? `${key}:${JSON.stringify(params)}` : key) }) }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

const apiMock = vi.mocked(api)

describe('usePodcastOpmlTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an oversized OPML file without replacing the selected file', () => {
    const transfer = usePodcastOpmlTransfer(ref(7))
    const accepted = new File(['<opml />'], 'feeds.opml', { type: 'text/xml' })
    const oversized = new File([new Uint8Array(5_000_001)], 'large.opml', { type: 'text/xml' })

    expect(transfer.selectImportFile(accepted)).toBe(true)
    expect(transfer.selectImportFile(oversized)).toBe(false)

    expect(transfer.importFile.value).toBe(accepted)
    expect(toastMocks.error).toHaveBeenCalledWith('podcast.errors.opmlTooLarge')
  })

  it('imports the file with the selected acquisition policy and returns the queue counts', async () => {
    apiMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ total: 4, queued: 3 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const transfer = usePodcastOpmlTransfer(ref(7))
    transfer.selectImportFile(new File(['<opml version="2.0" />'], 'feeds.opml', { type: 'text/xml' }))
    transfer.importPolicy.value = 'window'
    transfer.importWindowDays.value = 14

    await expect(transfer.importOpml()).resolves.toEqual({ total: 4, queued: 3 })

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-libraries/7/opml/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opml: '<opml version="2.0" />', acquisitionPolicy: 'window', autoDownloadWindowDays: 14 }),
    })
  })

  it('validates import policy values before reading or sending the file', async () => {
    const transfer = usePodcastOpmlTransfer(ref(7))
    transfer.selectImportFile(new File(['<opml />'], 'feeds.opml'))
    transfer.importPolicy.value = 'newest'
    transfer.importLimit.value = 0

    await expect(transfer.importOpml()).resolves.toBeNull()

    expect(apiMock).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledWith('podcast.errors.invalidEpisodeLimit')
  })

  it('exports a bounded download and reports omitted local shows', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:podcasts')
    const revokeObjectURL = vi.fn<(url: string) => void>()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    apiMock.mockResolvedValueOnce(
      new Response('<opml />', {
        status: 200,
        headers: { [PODCAST_OPML_OMITTED_HEADER]: '2' },
      }),
    )
    const transfer = usePodcastOpmlTransfer(ref(7))

    await transfer.exportOpml()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-libraries/7/opml/export')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:podcasts')
    expect(toastMocks.info).toHaveBeenCalledWith('podcast.messages.opmlOmittedLocalShows:{"count":2}')
  })
})
