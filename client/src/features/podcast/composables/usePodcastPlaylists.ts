import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PODCAST_PLAYLIST_MAX_SAVED, podcastScopeRules, type PodcastPlaylistRules } from '@bookorbit/types'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { normalizePlaylistRules } from '../lib/podcast-playlist-rules'

export const BUILT_IN_PLAYLIST_IDS = ['quick', 'continue', 'downloaded', 'fresh'] as const
export type BuiltInPlaylistId = (typeof BUILT_IN_PLAYLIST_IDS)[number]

export interface PodcastPlaylistOption {
  id: string
  name: string
  rules: PodcastPlaylistRules
  builtIn: boolean
}

const BUILT_IN_RULES: Record<BuiltInPlaylistId, PodcastPlaylistRules> = {
  quick: normalizePlaylistRules({ filter: 'unplayed', sort: 'shortest', maxDurationMinutes: 20 }),
  continue: normalizePlaylistRules({ filter: 'in_progress', sort: 'recently_listened' }),
  downloaded: normalizePlaylistRules({ filter: 'downloaded', sort: 'newest' }),
  fresh: normalizePlaylistRules({ filter: 'unplayed', sort: 'newest', publishedWithinDays: 7, followedOnly: true }),
}

/** Saved playlists require an icon now that they are scope rows; the built-ins are client-side. */
const SAVED_PLAYLIST_ICON = 'Podcast'

/**
 * Saved playlists are podcast smart scopes.
 *
 * They used to live in a `user_preferences` JSON blob, which gave them no ordering, no sharing and
 * no sidebar presence, and whose schema silently dropped a user's whole list if any playlist used
 * the `pinned` filter. They are now rows in `smart_scopes`, so the library's playlists tab and the
 * sidebar's Podcast Scopes section read and write exactly the same records.
 *
 * The string-id contract is kept so callers that hold ids in the URL keep working: built-ins use
 * their own slugs, saved ones use the scope id rendered as a string.
 */
export function usePodcastPlaylists(libraryId: Ref<number>) {
  const { t } = useI18n()
  const { podcastScopes, fetchSmartScopes, refreshSmartScopes, createSmartScope, updateSmartScope, deleteSmartScope } = useSmartScopes()

  const loaded = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const builtInPlaylists = computed<PodcastPlaylistOption[]>(() =>
    BUILT_IN_PLAYLIST_IDS.map((id) => ({ id, name: t(`podcast.playlists.builtIn.${id}`), rules: BUILT_IN_RULES[id], builtIn: true })),
  )

  const libraryScopes = computed(() => podcastScopes.value.filter((scope) => scope.libraryId === libraryId.value))

  const libraryPlaylists = computed<PodcastPlaylistOption[]>(() =>
    libraryScopes.value.map((scope) => ({
      id: String(scope.id),
      name: scope.name,
      rules: normalizePlaylistRules(podcastScopeRules(scope) ?? {}),
      builtIn: false,
    })),
  )

  /** Built-ins first, then the user's own, as one list rather than two identical loops. */
  const playlists = computed<PodcastPlaylistOption[]>(() => [...builtInPlaylists.value, ...libraryPlaylists.value])
  const canSaveMore = computed(() => libraryScopes.value.length < PODCAST_PLAYLIST_MAX_SAVED)

  async function load(): Promise<void> {
    try {
      await fetchSmartScopes()
      loaded.value = true
      error.value = null
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : t('podcast.errors.loadPlaylists')
    }
  }

  function findScope(id: string | undefined) {
    if (!id) return undefined
    const numericId = Number(id)
    return Number.isInteger(numericId) ? libraryScopes.value.find((scope) => scope.id === numericId) : undefined
  }

  /** Creates or replaces a saved playlist and returns its id so the caller can select it. */
  async function savePlaylist(input: { id?: string; name: string; rules: PodcastPlaylistRules }): Promise<string> {
    const name = input.name.trim()
    if (!name) throw new Error(t('podcast.errors.playlistNameRequired'))
    const rules = normalizePlaylistRules(input.rules)
    const existing = findScope(input.id)
    if (!existing && !canSaveMore.value) throw new Error(t('podcast.errors.playlistLimitReached'))

    saving.value = true
    try {
      if (existing) {
        await updateSmartScope(existing.id, { name, filter: rules })
        return String(existing.id)
      }
      const created = await createSmartScope({
        name,
        icon: SAVED_PLAYLIST_ICON,
        mediaType: 'podcasts',
        libraryId: libraryId.value,
        defaultSort: [],
        filter: rules,
      })
      return String(created.id)
    } finally {
      saving.value = false
      // The sidebar renders the same rows, so it has to see the change too.
      await refreshSmartScopes()
    }
  }

  async function deletePlaylist(id: string): Promise<void> {
    const existing = findScope(id)
    if (!existing) return
    await deleteSmartScope(existing.id)
  }

  function findPlaylist(id: string | null | undefined): PodcastPlaylistOption | null {
    if (!id) return null
    return playlists.value.find((playlist) => playlist.id === id) ?? null
  }

  return {
    playlists,
    builtInPlaylists,
    libraryPlaylists,
    loaded,
    error,
    load,
    savePlaylist,
    deletePlaylist,
    findPlaylist,
  }
}
