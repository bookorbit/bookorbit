import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, inject, nextTick, ref, type Ref } from 'vue'
import type { PodcastEpisodePage, SmartScope } from '@bookorbit/types'
import { PODCAST_EPISODE_ACTIONS } from '../composables/usePodcastEpisodeListActions'

const routeParams = ref<Record<string, string>>({ id: '9' })
const push = vi.fn<() => void>()

vi.mock('vue-router', () => ({
  useRoute: () => ({
    get params() {
      return routeParams.value
    },
  }),
  useRouter: () => ({ push }),
  // The view now pulls in useMediaMode, whose dependency chain reaches the router module.
}))

// Mocked directly: its real dependency chain reaches the router module, which registers guards on import.
vi.mock('@/composables/useMediaMode', () => ({
  mediaModeHome: (target: string, libraries: { id: number }[]) =>
    target === 'podcasts' && libraries.length === 1 ? { name: 'podcast-library', params: { id: libraries[0].id } } : { name: 'podcast-libraries' },
}))

const smartScopes = ref<SmartScope[]>([])
const scopesLoaded = ref(false)
const scopesError = ref<string | null>(null)
const fetchScopeEpisodes = vi.fn<(id: number, page: number, size: number, q?: string) => Promise<PodcastEpisodePage>>()
const fetchSmartScopes = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const refreshSmartScopes = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

const applyScopeEpisodeCount = vi.fn<(id: number, total: number) => void>()
const updateSmartScope = vi.fn<(id: number, payload: Record<string, unknown>) => Promise<unknown>>()
const deleteSmartScope = vi.fn<(id: number) => Promise<void>>()

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({
    smartScopes,
    loaded: scopesLoaded,
    error: scopesError,
    fetchSmartScopes,
    refreshSmartScopes,
    updateSmartScope,
    deleteSmartScope,
    fetchScopeEpisodes,
    applyScopeEpisodeCount,
  }),
}))

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn<() => void>() }))
vi.mock('vue-sonner', () => ({ toast: { error: toastError, success: vi.fn<() => void>() } }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => name === 'podcast_download' }),
}))

const playInline = vi.fn<(episodeId: number) => Promise<void>>().mockResolvedValue(undefined)
const togglePlayback = vi.fn<() => void>()
const currentEpisode = ref<{ id: number } | null>(null)

vi.mock('@/features/podcast/composables/usePodcastPlayer', () => ({
  usePodcastPlayer: () => ({ episode: currentEpisode, isPlaying: ref(false), playInline, togglePlayback }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([{ id: 4, type: 'podcasts' }]) }),
}))

vi.mock('@/composables/useInfiniteScrollSentinel', () => ({
  useInfiniteScrollSentinel: () => ({ sentinel: ref(null) }),
}))

// Real Intl so the rule summary's unit values ("30 minutes") are asserted as users read them.
vi.mock('@/i18n/formatters', () => ({
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat('en', options).format(value),
}))

import PodcastScopeView from './PodcastScopeView.vue'

function makeScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return {
    id: 9,
    userId: 1,
    mediaType: 'podcasts',
    libraryId: 4,
    name: 'Short commutes',
    icon: 'Aperture',
    filter: null,
    defaultSort: [],
    isPublic: false,
    syncToKobo: false,
    koboSyncEnabled: false,
    isOwner: true,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makePage(count: number, total = count): PodcastEpisodePage {
  return {
    items: Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `Episode ${index + 1}` })) as PodcastEpisodePage['items'],
    total,
    totalDurationSeconds: 0,
    page: 1,
    size: 50,
  }
}

const mountGlobal = {
  stubs: {
    EmptyState: { name: 'EmptyState', props: ['title', 'hint', 'icon'], template: '<div class="empty">{{ title }}</div>' },
    EntityNotFound: { name: 'EntityNotFound', props: ['entity'], template: '<div class="not-found">{{ entity }}</div>' },
    AppIcon: true,
    PodcastPlaylistEditor: {
      name: 'PodcastPlaylistEditor',
      props: ['open', 'libraryId', 'playlist', 'saving'],
      template: '<div class="editor" :data-open="String(open)" :data-library="libraryId">{{ playlist?.rules?.filter }}</div>',
    },
    PodcastEpisodeRow: {
      name: 'PodcastEpisodeRow',
      props: ['episode', 'canDownload', 'isActive', 'isPlaying'],
      setup: () => ({ actions: inject(PODCAST_EPISODE_ACTIONS) }),
      template: '<li class="episode" @click="actions.play(episode)">{{ episode.title }}</li>',
    },
  },
}

function mountView() {
  return mount(PodcastScopeView, { global: mountGlobal })
}

function mountKeptAliveView(visible: Ref<boolean>) {
  return mount(
    defineComponent({
      components: { PodcastScopeView },
      setup: () => ({ visible }),
      template: '<KeepAlive><PodcastScopeView v-if="visible" /></KeepAlive>',
    }),
    {
      global: mountGlobal,
    },
  )
}

describe('PodcastScopeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeParams.value = { id: '9' }
    smartScopes.value = [makeScope()]
    scopesLoaded.value = true
    scopesError.value = null
    currentEpisode.value = null
    fetchScopeEpisodes.mockResolvedValue(makePage(2))
    updateSmartScope.mockResolvedValue(makeScope())
    deleteSmartScope.mockResolvedValue(undefined)
  })

  it('loads the scope episodes for the routed id', async () => {
    mountView()
    await flushPromises()

    expect(fetchSmartScopes).toHaveBeenCalledTimes(1)
    expect(refreshSmartScopes).not.toHaveBeenCalled()
    expect(fetchScopeEpisodes).toHaveBeenCalledWith(9, 0, 50)
    expect(fetchScopeEpisodes).toHaveBeenCalledTimes(1)
  })

  // The sidebar badge reads the scope's stored count; reconciling it belongs to the cache that owns
  // the scope, not to this view reaching into it.
  it('hands the loaded total back to the smart-scope cache', async () => {
    mountView()
    await flushPromises()

    expect(applyScopeEpisodeCount).toHaveBeenCalledWith(9, 2)
  })

  it('does not reload network state when KeepAlive reactivates the cached view', async () => {
    const visible = ref(true)
    mountKeptAliveView(visible)
    await flushPromises()

    visible.value = false
    await nextTick()
    visible.value = true
    await flushPromises()

    expect(fetchSmartScopes).toHaveBeenCalledTimes(1)
    expect(refreshSmartScopes).not.toHaveBeenCalled()
    expect(fetchScopeEpisodes).toHaveBeenCalledTimes(1)
  })

  it('renders one row per matching episode', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('.episode')).toHaveLength(2)
  })

  it('shows the scope name and its episode total', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Short commutes')
    expect(wrapper.text()).toContain('2')
  })

  it('renders an empty state when the rules match nothing', async () => {
    fetchScopeEpisodes.mockResolvedValue(makePage(0))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.empty').exists()).toBe(true)
  })

  it('surfaces a load failure instead of rendering a silent empty list', async () => {
    fetchScopeEpisodes.mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('reports a missing scope once the list has loaded', async () => {
    smartScopes.value = []
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.not-found').exists()).toBe(true)
  })

  it('refreshes sidebar state only after a stale routed scope fails', async () => {
    fetchScopeEpisodes.mockRejectedValueOnce(new Error('HTTP 400'))
    refreshSmartScopes.mockImplementationOnce(async () => {
      smartScopes.value = []
    })
    const wrapper = mountView()
    await flushPromises()

    expect(fetchScopeEpisodes).toHaveBeenCalledTimes(1)
    expect(refreshSmartScopes).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.not-found').exists()).toBe(true)
  })

  it('does not flash the empty state while waiting for sidebar scope state', async () => {
    let finishFetch!: () => void
    fetchSmartScopes.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishFetch = resolve
      }),
    )
    const wrapper = mountView()
    await nextTick()

    expect(wrapper.find('.empty').exists()).toBe(false)
    expect(fetchScopeEpisodes).not.toHaveBeenCalled()

    finishFetch()
    await flushPromises()

    expect(fetchScopeEpisodes).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.episode')).toHaveLength(2)
  })

  it('does not send a books scope to the podcast episodes endpoint', async () => {
    smartScopes.value = [makeScope({ mediaType: 'books', libraryId: null })]
    const wrapper = mountView()
    await flushPromises()

    expect(fetchScopeEpisodes).not.toHaveBeenCalled()
    expect(wrapper.find('.not-found').exists()).toBe(true)
  })

  it('starts playback for a different episode and toggles the one already playing', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('.episode')[0].trigger('click')
    expect(playInline).toHaveBeenCalledWith(1)

    currentEpisode.value = { id: 1 }
    await wrapper.findAll('.episode')[0].trigger('click')
    expect(togglePlayback).toHaveBeenCalled()
  })

  describe('rules editor', () => {
    const RULES = {
      filter: 'unplayed',
      sort: 'shortest',
      minDurationMinutes: null,
      maxDurationMinutes: 30,
      publishedWithinDays: null,
      podcastIds: [],
      followedOnly: false,
    }

    it('offers an edit control to the owner so the rules are not frozen at creation', async () => {
      const wrapper = mountView()
      await flushPromises()

      expect(wrapper.find('header button').exists()).toBe(true)
    })

    it('hides the edit control on a scope owned by someone else', async () => {
      smartScopes.value = [makeScope({ isOwner: false })]
      const wrapper = mountView()
      await flushPromises()

      expect(wrapper.find('header button').exists()).toBe(false)
    })

    it('seeds the editor with the scope stored rules and its library', async () => {
      smartScopes.value = [makeScope({ filter: RULES as never, libraryId: 4 })]
      const wrapper = mountView()
      await flushPromises()

      const editor = wrapper.get('.editor')
      expect(editor.attributes('data-library')).toBe('4')
      expect(editor.text()).toBe('unplayed')
    })

    it('states the rules on the page so they are not hidden behind the editor', async () => {
      smartScopes.value = [makeScope({ filter: { ...RULES, publishedWithinDays: 7, followedOnly: true, podcastIds: [3, 4] } as never })]
      const wrapper = mountView()
      await flushPromises()

      const summary = wrapper.getComponent({ name: 'PodcastPlaylistRuleSummary' }).text()
      expect(summary).toContain('Unplayed')
      expect(summary).toContain('30 minutes')
      expect(summary).toContain('7 days')
      expect(summary).toContain('Following only')
      expect(summary).toContain('Shortest first')
    })

    it('leaves out the bounds a playlist does not set', async () => {
      const wrapper = mountView()
      await flushPromises()

      const summary = wrapper.getComponent({ name: 'PodcastPlaylistRuleSummary' }).text()
      expect(summary).toContain('Latest')
      expect(summary).not.toContain('minutes')
      expect(summary).not.toContain('days')
      expect(summary).not.toContain('Following only')
    })

    it('opens the editor from the rule summary as well as the header control', async () => {
      const wrapper = mountView()
      await flushPromises()

      const summaryButton = wrapper.findAllComponents({ name: 'PodcastPlaylistRuleSummary' })[0].element.closest('button')
      expect(summaryButton).not.toBeNull()
      summaryButton!.click()
      await nextTick()

      expect(wrapper.get('.editor').attributes('data-open')).toBe('true')
    })

    it('states the rules without offering the editor to a non-owner', async () => {
      smartScopes.value = [makeScope({ isOwner: false })]
      const wrapper = mountView()
      await flushPromises()

      const summary = wrapper.getComponent({ name: 'PodcastPlaylistRuleSummary' })
      expect(summary.text()).toContain('Latest')
      expect(summary.element.closest('button')).toBeNull()
    })

    it('opens the editor when the edit control is used', async () => {
      const wrapper = mountView()
      await flushPromises()

      expect(wrapper.get('.editor').attributes('data-open')).toBe('false')
      await wrapper.find('header button').trigger('click')

      expect(wrapper.get('.editor').attributes('data-open')).toBe('true')
    })

    it('persists edited rules and reloads the episode list', async () => {
      const wrapper = mountView()
      await flushPromises()
      fetchScopeEpisodes.mockClear()

      wrapper.getComponent({ name: 'PodcastPlaylistEditor' }).vm.$emit('save', { name: 'Renamed', rules: RULES })
      await flushPromises()

      expect(updateSmartScope).toHaveBeenCalledWith(9, { name: 'Renamed', filter: RULES })
      expect(fetchScopeEpisodes).toHaveBeenCalled()
    })

    it('keeps the editor open and reports failure when saving fails', async () => {
      updateSmartScope.mockRejectedValue(new Error('boom'))
      const wrapper = mountView()
      await flushPromises()
      await wrapper.find('header button').trigger('click')

      wrapper.getComponent({ name: 'PodcastPlaylistEditor' }).vm.$emit('save', { name: 'Renamed', rules: RULES })
      await flushPromises()

      expect(toastError).toHaveBeenCalled()
      expect(wrapper.get('.editor').attributes('data-open')).toBe('true')
    })

    it('deletes the scope and leaves the now-dead route', async () => {
      const wrapper = mountView()
      await flushPromises()

      wrapper.getComponent({ name: 'PodcastPlaylistEditor' }).vm.$emit('delete', '9')
      await flushPromises()

      expect(deleteSmartScope).toHaveBeenCalledWith(9)
      // Staying in podcast mode: the books dashboard would leave podcast navigation around book content.
      expect(push).toHaveBeenCalledWith({ name: 'podcast-library', params: { id: 4 } })
    })
  })
})
