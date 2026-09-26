import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import { jsonResponse, makeShow as show } from '../test/fixtures'
import { usePodcastShowManagement, type PodcastShowSettingsInput } from './usePodcastShowManagement'

const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))
const playerMocks = vi.hoisted(() => ({ playInline: vi.fn<(episodeId: number) => Promise<void>>(async () => undefined) }))
const downloadMocks = vi.hoisted(() => ({ track: vi.fn<(batchId: string | null) => Promise<void>>(async () => undefined) }))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('./usePodcastPlayer', () => ({ usePodcastPlayer: () => playerMocks }))
vi.mock('./usePodcastDownloadBatches', () => ({ usePodcastDownloadBatches: () => downloadMocks }))

const apiMock = vi.mocked(api)

function settings(overrides: Partial<PodcastShowSettingsInput> = {}): PodcastShowSettingsInput {
  return {
    acquisitionPolicy: 'newest',
    autoDownloadLimit: 5,
    autoDownloadWindowDays: 30,
    downloadCleanup: 'after_finished',
    downloadCleanupDelayHours: 12,
    refreshIntervalMinutes: 120,
    ...overrides,
  }
}

function createManagement(summary = show()) {
  const current = ref<PodcastSummary | null>(summary)
  const reload = vi.fn<() => Promise<void>>(async () => undefined)
  const onDeleted = vi.fn<() => void>()
  const management = usePodcastShowManagement(ref(12), current, reload, onDeleted)
  return { management, current, reload, onDeleted }
}

describe('usePodcastShowManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it('omits feed-only settings when saving a local show', async () => {
    const { management, reload } = createManagement(show({ origin: 'local' }))

    await management.saveSettings(settings())

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadCleanup: 'after_finished', downloadCleanupDelayHours: 12 }),
    })
    expect(reload).toHaveBeenCalledOnce()
  })

  it('validates feed settings before making a request', async () => {
    const { management } = createManagement()

    await management.saveSettings(settings({ refreshIntervalMinutes: 4 }))

    expect(apiMock).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledWith('podcast.errors.invalidRefresh')
  })

  it('archives an active show before permanently purging it', async () => {
    const { management, onDeleted } = createManagement()

    await management.deleteShow()

    expect(apiMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/podcasts/12/archive', '/api/v1/podcasts/12/purge'])
    expect(onDeleted).toHaveBeenCalledOnce()
  })

  it('filters the current show out of bounded merge candidates', async () => {
    apiMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { id: 12, title: 'Orbit Radio' },
          { id: 14, title: 'Orbit Archive' },
        ],
        total: 2,
        page: 0,
        size: 20,
      }),
    )
    const { management } = createManagement()

    await management.searchMergeCandidates(' orbit ')

    // Pages are 0-based server-side, so the first page has to be requested as 0 or the search
    // silently starts at the 21st match.
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-libraries/7/podcasts?q=orbit&page=0&size=20', undefined)
    expect(management.mergeCandidates.value.map((candidate) => candidate.id)).toEqual([14])
  })

  it('persists notification changes only for followed shows', async () => {
    const { management, current } = createManagement(show({ followed: true, notificationMode: 'daily' }))

    await management.handleNotificationModeUpdate('weekly')

    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body))).toEqual({ notificationMode: 'weekly' })
    expect(current.value?.notificationMode).toBe('weekly')
  })
})
