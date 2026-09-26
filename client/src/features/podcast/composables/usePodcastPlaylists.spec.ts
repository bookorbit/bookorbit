import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { PODCAST_PLAYLIST_MAX_SAVED, type PodcastScopeRules, type SmartScope } from '@bookorbit/types'
import { usePodcastPlaylists } from './usePodcastPlaylists'
import { normalizePlaylistRules } from '../lib/podcast-playlist-rules'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

/**
 * Saved playlists are podcast smart scope rows, so the library's playlists tab and the sidebar's
 * Podcast Scopes section stay one list rather than two competing ones.
 */
const scopes = ref<SmartScope[]>([])
const fetchSmartScopes = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const refreshSmartScopes = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const createSmartScope = vi.fn<(payload: Record<string, unknown>) => Promise<SmartScope>>()
const updateSmartScope = vi.fn<(id: number, payload: Record<string, unknown>) => Promise<SmartScope>>()
const deleteSmartScope = vi.fn<(id: number) => Promise<void>>()

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({
    podcastScopes: computed(() => scopes.value.filter((scope) => scope.mediaType === 'podcasts')),
    fetchSmartScopes,
    refreshSmartScopes,
    createSmartScope,
    updateSmartScope,
    deleteSmartScope,
  }),
}))

function makeScope(id: number, libraryId: number, name = 'Morning commute', rules?: Partial<PodcastScopeRules>): SmartScope {
  return {
    id,
    userId: 1,
    mediaType: 'podcasts',
    libraryId,
    name,
    icon: 'Podcast',
    filter: normalizePlaylistRules({ filter: 'unplayed', maxDurationMinutes: 30, ...rules }),
    defaultSort: [],
    isPublic: false,
    syncToKobo: false,
    koboSyncEnabled: false,
    isOwner: true,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('usePodcastPlaylists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scopes.value = []
    createSmartScope.mockResolvedValue(makeScope(99, 7, 'Created'))
    updateSmartScope.mockResolvedValue(makeScope(1, 7))
    deleteSmartScope.mockResolvedValue(undefined)
  })

  it('always offers the built-in playlists, even before saved ones load', () => {
    const playlists = usePodcastPlaylists(ref(7))

    expect(playlists.playlists.value.map((playlist) => playlist.id)).toEqual(['quick', 'continue', 'downloaded', 'fresh'])
    expect(playlists.findPlaylist('quick')?.rules).toMatchObject({ filter: 'unplayed', sort: 'shortest', maxDurationMinutes: 20 })
    expect(playlists.findPlaylist('fresh')?.rules).toMatchObject({ publishedWithinDays: 7, followedOnly: true })
  })

  it('shows only the saved playlists that belong to the open library', () => {
    scopes.value = [makeScope(1, 7, 'Mine'), makeScope(2, 9, 'Other library')]
    const playlists = usePodcastPlaylists(ref(7))

    expect(playlists.libraryPlaylists.value.map((playlist) => playlist.name)).toEqual(['Mine'])
    expect(playlists.playlists.value).toHaveLength(5)
  })

  it('exposes a saved playlist under its scope id, so URLs keep resolving', () => {
    scopes.value = [makeScope(12, 7, 'Mine')]
    const playlists = usePodcastPlaylists(ref(7))

    expect(playlists.findPlaylist('12')?.name).toBe('Mine')
    expect(playlists.findPlaylist('12')?.builtIn).toBe(false)
  })

  it('creates a new saved playlist as a podcast scope in the open library', async () => {
    const playlists = usePodcastPlaylists(ref(7))

    const id = await playlists.savePlaylist({ name: '  Evening  ', rules: normalizePlaylistRules({ filter: 'downloaded' }) })

    expect(createSmartScope).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Evening', mediaType: 'podcasts', libraryId: 7, filter: expect.objectContaining({ filter: 'downloaded' }) }),
    )
    expect(id).toBe('99')
    expect(refreshSmartScopes).toHaveBeenCalled()
  })

  it('replaces an existing playlist instead of adding a duplicate', async () => {
    scopes.value = [makeScope(1, 7, 'Morning commute')]
    const playlists = usePodcastPlaylists(ref(7))

    const id = await playlists.savePlaylist({ id: '1', name: 'Renamed', rules: normalizePlaylistRules({ filter: 'finished' }) })

    expect(updateSmartScope).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Renamed' }))
    expect(createSmartScope).not.toHaveBeenCalled()
    expect(id).toBe('1')
  })

  it('refuses an unnamed playlist and one past the saved limit', async () => {
    const playlists = usePodcastPlaylists(ref(7))
    await expect(playlists.savePlaylist({ name: '   ', rules: normalizePlaylistRules({}) })).rejects.toThrow('podcast.errors.playlistNameRequired')

    scopes.value = Array.from({ length: PODCAST_PLAYLIST_MAX_SAVED }, (_, index) => makeScope(index + 1, 7, `Saved ${index}`))
    await expect(playlists.savePlaylist({ name: 'One too many', rules: normalizePlaylistRules({}) })).rejects.toThrow(
      'podcast.errors.playlistLimitReached',
    )
    expect(createSmartScope).not.toHaveBeenCalled()
  })

  it('deletes a saved playlist by its scope id and ignores an unknown one', async () => {
    scopes.value = [makeScope(1, 7)]
    const playlists = usePodcastPlaylists(ref(7))

    await playlists.deletePlaylist('1')
    expect(deleteSmartScope).toHaveBeenCalledWith(1)

    await playlists.deletePlaylist('quick')
    await playlists.deletePlaylist('404')
    expect(deleteSmartScope).toHaveBeenCalledTimes(1)
  })

  it('keeps the built-ins usable when the saved playlists cannot be loaded', async () => {
    fetchSmartScopes.mockRejectedValueOnce(new Error('offline'))
    const playlists = usePodcastPlaylists(ref(7))

    await playlists.load()

    expect(playlists.error.value).toBeTruthy()
    expect(playlists.playlists.value.map((playlist) => playlist.id)).toEqual(['quick', 'continue', 'downloaded', 'fresh'])
  })
})
