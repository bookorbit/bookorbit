import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MetadataProviderKey, Permission } from '@bookorbit/types'
import type { BookRequestMediaKind, MetadataCandidate, MetadataProviderInfo, ResolvedRequestDestination } from '@bookorbit/types'
import type { Ref } from 'vue'
import type { CandidateGroup } from '../composables/useCandidateGroups'

/**
 * Refs cannot be built in `vi.hoisted`, which runs before any import. The mock factories build
 * them instead and hand them back through this holder, so a test can drive the medium and the
 * library list the component is looking at.
 */
const state = vi.hoisted(
  () =>
    ({
      hasPermission: vi.fn<(permission: string) => boolean>(),
      defaultFor: vi.fn<(mediaKind: BookRequestMediaKind) => ResolvedRequestDestination>(),
      submit: vi.fn<() => Promise<unknown>>(),
      submitFreeText: vi.fn<() => Promise<unknown>>(),
      checkFreeText: vi.fn<() => Promise<unknown>>(),
      push: vi.fn<() => Promise<void>>(),
      routeQuery: {} as Record<string, string>,
      toastError: vi.fn<(message: string) => void>(),
    }) as {
      hasPermission: ReturnType<typeof vi.fn>
      defaultFor: ReturnType<typeof vi.fn>
      mediaKind: Ref<BookRequestMediaKind>
      libraries: Ref<{ id: number; name: string; folders: { id: number; path: string }[] }[]>
      hasSearched: Ref<boolean>
      providers: Ref<MetadataProviderInfo[]>
      groups: Ref<CandidateGroup[]>
      submit: ReturnType<typeof vi.fn>
      submitFreeText: ReturnType<typeof vi.fn>
      checkFreeText: ReturnType<typeof vi.fn>
      push: ReturnType<typeof vi.fn>
      routeQuery: Record<string, string>
      toastError: ReturnType<typeof vi.fn>
      lastFailure: Ref<{ code: string | null; meta: Record<string, unknown> | null; message: string | null } | null>
    },
)

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<(message: string) => void>(), error: state.toastError },
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: state.hasPermission }),
}))

// Who is signed in decides where a submitted request sends you, so the panel needs a user.
vi.mock('@/features/auth/composables/useAuth', async () => {
  const { ref } = await import('vue')
  return { useAuth: () => ({ user: ref({ id: 7, username: 'ux' }) }) }
})

vi.mock('@/features/library/composables/useLibraries', async () => {
  const { ref } = await import('vue')
  state.libraries = ref([])
  return { useLibraries: () => ({ libraries: state.libraries, fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }) }
})

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push: state.push }),
  useRoute: () => ({ query: state.routeQuery }),
}))

vi.mock('@/features/book/composables/useMetadataSearch', async () => {
  const { ref } = await import('vue')
  state.hasSearched = ref(false)
  state.providers = ref([])
  return {
    useMetadataSearch: () => ({
      filteredResults: ref([]),
      coverProviderOrder: ref([]),
      resultProviderOrder: ref([]),
      interruptedProviders: ref([]),
      isStreaming: ref(false),
      hasSearched: state.hasSearched,
      providers: state.providers,
      loadProviders: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      search: vi.fn<() => void>(),
    }),
  }
})

vi.mock('../composables/useRequestSubmission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useRequestSubmission')>()
  const { ref } = await import('vue')
  state.mediaKind = ref<BookRequestMediaKind>('ebook')
  state.lastFailure = ref(null)
  return {
    ...actual,
    useRequestSubmission: () => ({
      lastFailure: state.lastFailure,
      submitting: ref(null),
      mediaKind: state.mediaKind,
      annotate: vi.fn<() => void>(),
      getAvailability: vi.fn<() => null>().mockReturnValue(null),
      submit: state.submit,
      submitFreeText: state.submitFreeText,
      checkFreeText: state.checkFreeText,
      candidateKey: vi.fn<() => string>().mockReturnValue('k'),
    }),
  }
})

vi.mock('../composables/useCandidateGroups', async () => {
  const { ref } = await import('vue')
  state.groups = ref([])
  return { useCandidateGroups: () => ({ groups: state.groups }) }
})

vi.mock('../composables/useRequestDestinationDefault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useRequestDestinationDefault')>()
  const { ref } = await import('vue')
  return {
    ...actual,
    useRequestDestinationDefault: () => ({
      destinations: ref({}),
      load: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      defaultFor: state.defaultFor,
      // The panel never preselects the instance default; only what the request already carries.
      resolveDestination: () => ({ libraryId: null, folderId: null }),
    }),
    useRequestLanguageDefault: () => ({
      defaultLanguage: ref(null),
      isSaving: ref(false),
      load: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      setDefault: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      resolveLanguage: () => null,
    }),
  }
})

// Static, so every mock factory above has run by the time `beforeEach` reaches for its refs.
import RequestSearchPanel from '../components/RequestSearchPanel.vue'

const NO_DEFAULT: ResolvedRequestDestination = { libraryId: null, libraryName: null, folderId: null }

async function render() {
  const wrapper = mount(RequestSearchPanel)
  // The panel resolves its destination in an async `onMounted`.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return wrapper
}

/** The hint the panel shows when an auto-approving requester has nowhere to put the book. */
function blockingHint(wrapper: Awaited<ReturnType<typeof render>>): boolean {
  return wrapper.text().includes('pick the library the book should land in')
}

beforeEach(() => {
  state.providers.value = []
  state.groups.value = []
  state.routeQuery = {}
})

describe('RequestSearchPanel provider sources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.mediaKind.value = 'ebook'
    state.libraries.value = []
    state.hasPermission.mockReturnValue(false)
    state.defaultFor.mockReturnValue(NO_DEFAULT)
    state.providers.value = [
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.AMAZON, label: 'Amazon', identifiable: true },
      { key: MetadataProviderKey.COMICVINE, label: 'ComicVine', identifiable: true },
    ]
    const google: MetadataCandidate = {
      provider: MetadataProviderKey.GOOGLE,
      providerId: 'google-1',
      title: 'One Dark Window',
      isbn13: '9780441013593',
      publishedYear: 2022,
      language: 'en',
    }
    const amazon: MetadataCandidate = {
      provider: MetadataProviderKey.AMAZON,
      providerId: 'amazon-1',
      title: 'One Dark Window',
      isbn10: '0441013597',
      publishedYear: 2022,
      language: 'en',
    }
    const comicVine: MetadataCandidate = {
      provider: MetadataProviderKey.COMICVINE,
      providerId: 'comicvine-1',
      title: 'One Dark Window',
      isbn13: '9781250301697',
      publishedYear: 2023,
      language: 'en',
    }
    state.groups.value = [
      {
        key: 'one-dark-window',
        candidate: google,
        candidates: [google, amazon, comicVine],
        isbns: ['9780441013593', '9781250301697'],
        isbnChoices: [
          {
            isbn: '9780441013593',
            candidate: google,
            providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.AMAZON],
            languageRank: 1,
            agreementCount: 2,
            providerPriority: 0,
            providerResultRank: 0,
            yearDistance: 0,
          },
          {
            isbn: '9781250301697',
            candidate: comicVine,
            providers: [MetadataProviderKey.COMICVINE],
            languageRank: 1,
            agreementCount: 1,
            providerPriority: 1,
            providerResultRank: 0,
            yearDistance: 1,
          },
        ],
        recommendedIsbnChoice: {
          isbn: '9780441013593',
          candidate: google,
          providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.AMAZON],
          languageRank: 1,
          agreementCount: 2,
          providerPriority: 0,
          providerResultRank: 0,
          yearDistance: 0,
        },
        title: 'One Dark Window',
        authors: ['Rachel Gillig'],
        coverUrl: null,
        coverUrls: [],
        publishedYear: 2022,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.AMAZON, MetadataProviderKey.COMICVINE],
        availability: null,
      },
    ]
  })

  it('shows every contributing provider as an icon or initials badge', async () => {
    const wrapper = await render()
    const sources = wrapper.get('[role="img"]')

    expect(sources.find('img[src="/assets/provider-icons/google.svg"]').exists()).toBe(true)
    expect(sources.find('img[src="/assets/provider-icons/amazon.svg"]').exists()).toBe(true)
    expect(sources.attributes('aria-label')).toContain('Google Books, Amazon, ComicVine')
    expect(sources.text()).toContain('CO')
    expect(sources.text()).not.toContain('3 sources')
  })

  it('exposes identifier conflicts and their provider provenance on demand', async () => {
    const wrapper = await render()
    const identifierButton = wrapper.findAll('button').find((button) => button.text().includes('2 ISBNs'))!

    await identifierButton.trigger('click')

    const text = wrapper.text()
    expect(text).toContain('Metadata sources')
    expect(text).toContain('Choose one of 2 ISBNs to search, or search by title and author.')
    expect(text).toContain('9780441013593')
    expect(text).toContain('9781250301697')
    expect(text).toContain('Google Books')
    expect(text).toContain('Amazon')
    expect(text).toContain('ComicVine')
  })

  it('keeps the explicit ISBN chooser bounded when a grouped work carries many identifiers', async () => {
    state.groups.value[0]!.isbns = Array.from({ length: 9 }, (_, index) => `978000000000${index}`)
    const wrapper = await render()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('9 ISBNs'))!
      .trigger('click')

    expect(wrapper.text()).toContain('Choose one of 8 ISBNs to search, or search by title and author.')
  })

  it('uses the representative metadata ISBN deterministically for the primary action', async () => {
    state.submit.mockResolvedValue(null)
    const wrapper = await render()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Request')!
      .trigger('click')

    expect(state.submit).toHaveBeenCalledWith(
      state.groups.value[0]!.candidate,
      expect.objectContaining({
        isbn10: null,
        isbn13: '9780441013593',
        providerKey: MetadataProviderKey.GOOGLE,
        providerId: 'google-1',
        metadataSources: [
          expect.objectContaining({ providerKey: MetadataProviderKey.GOOGLE, providerId: 'google-1', isbn13: '9780441013593' }),
          expect.objectContaining({ providerKey: MetadataProviderKey.AMAZON, providerId: 'amazon-1', isbn10: '0441013597' }),
          expect.objectContaining({ providerKey: MetadataProviderKey.COMICVINE, providerId: 'comicvine-1', isbn13: '9781250301697' }),
        ],
      }),
    )
  })

  it('sends the note and preferred formats selected in the request form', async () => {
    state.submit.mockResolvedValue(null)
    const wrapper = await render()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('More options'))!
      .trigger('click')
    await wrapper.get('button[aria-label="Prefer EPUB"]').trigger('click')
    await wrapper.get('#request-note').setValue('Please use the illustrated edition')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Request')!
      .trigger('click')

    expect(state.submit).toHaveBeenCalledWith(
      state.groups.value[0]!.candidate,
      expect.objectContaining({ preferredFormats: ['epub'], note: 'Please use the illustrated edition' }),
    )
  })

  it('shows the recommended ISBN and explains the deterministic ranking', async () => {
    state.hasPermission.mockImplementation((permission: string) => permission === Permission.BookRequestSelfFulfill)
    state.defaultFor.mockReturnValue({ libraryId: 4, libraryName: 'Novels', folderId: null })
    const wrapper = await render()

    expect(wrapper.findAll('button').find((button) => button.text() === 'Download')).toBeDefined()

    await wrapper.get('button[aria-label="How BookOrbit chooses the recommended ISBN"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('How the recommended search is chosen')
    expect(document.body.textContent).toContain('ISBN 9780441013593')
    expect(document.body.textContent).toContain('Prefer the requested language')

    await wrapper.get('button[aria-label="Choose an edition to search"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('Recommended')
  })

  it('lets a self-fulfilling user search the exact ISBN from a metadata row', async () => {
    state.hasPermission.mockImplementation((permission: string) => permission === Permission.BookRequestSelfFulfill)
    state.defaultFor.mockReturnValue({ libraryId: 4, libraryName: 'Novels', folderId: null })
    state.submit.mockResolvedValue({ request: { id: 31, userId: 7, status: 'approved' }, subscribed: false })
    const wrapper = await render()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('2 ISBNs'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Find release')!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.submit).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'google-1' }),
      expect.objectContaining({ isbn13: '9780441013593', providerKey: MetadataProviderKey.GOOGLE, providerId: 'google-1' }),
    )
    expect(state.push).toHaveBeenCalledWith({
      name: 'book-request-releases',
      params: { id: 31 },
      query: { isbn: '9780441013593' },
    })
  })

  /** The picker is a route on top of the list, and closing it goes back to whatever was underneath. */
  it('carries the list query into the picker and clears the ISBN of the last request', async () => {
    state.routeQuery = { tab: 'all', status: 'pending', isbn: '9780000000001' }
    state.hasPermission.mockImplementation((permission: string) => permission === Permission.BookRequestSelfFulfill)
    state.defaultFor.mockReturnValue({ libraryId: 4, libraryName: 'Novels', folderId: null })
    state.submit.mockResolvedValue({ request: { id: 31, userId: 7, status: 'approved' }, subscribed: false })
    const wrapper = await render()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('2 ISBNs'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Find release')!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.push).toHaveBeenCalledWith({
      name: 'book-request-releases',
      params: { id: 31 },
      query: { tab: 'all', status: 'pending', isbn: '9780441013593' },
    })
  })
})

describe('RequestSearchPanel destination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.mediaKind.value = 'ebook'
    state.libraries.value = [
      { id: 4, name: 'Novels', folders: [{ id: 9, path: '/books' }] },
      { id: 5, name: 'Audiobooks', folders: [{ id: 10, path: '/audio' }] },
    ]
    state.hasPermission.mockImplementation((permission: string) => permission === Permission.BookRequestAutoApprove)
    state.defaultFor.mockReturnValue(NO_DEFAULT)
  })

  /**
   * The regression this exists for. Nothing is preselected any more, so an auto-approving
   * requester sits on an unpicked select by default; reading that as "no destination" disabled
   * every Request button on any instance that had defaults configured.
   */
  it('lets an auto-approving requester submit on the instance default alone', async () => {
    state.defaultFor.mockReturnValue({ libraryId: 4, libraryName: 'Novels', folderId: 9 })

    const wrapper = await render()

    expect(blockingHint(wrapper)).toBe(false)
  })

  it('names the instance default rather than leaving the select blank', async () => {
    state.defaultFor.mockReturnValue({ libraryId: 4, libraryName: 'Novels', folderId: 9 })

    const wrapper = await render()

    expect(wrapper.get('#request-library').text()).toContain('Default (Novels)')
  })

  it('still blocks an auto-approving requester when there is no default either', async () => {
    const wrapper = await render()

    expect(blockingHint(wrapper)).toBe(true)
  })

  it('stops blocking once a library is picked by hand', async () => {
    const wrapper = await render()
    expect(blockingHint(wrapper)).toBe(true)

    await wrapper.get('#request-library').setValue('4')

    expect(blockingHint(wrapper)).toBe(false)
  })

  /** Only the auto-approving requester is stuck; everyone else has an approver to decide. */
  it('never blocks a requester whose requests go to an approver', async () => {
    state.hasPermission.mockReturnValue(false)

    const wrapper = await render()

    expect(blockingHint(wrapper)).toBe(false)
  })

  /** The default is per medium, so the answer has to follow the segmented control. */
  it('reads the default for the medium currently selected', async () => {
    state.defaultFor.mockImplementation((kind: BookRequestMediaKind) =>
      kind === 'audiobook' ? { libraryId: 5, libraryName: 'Audiobooks', folderId: 10 } : NO_DEFAULT,
    )

    const wrapper = await render()
    expect(blockingHint(wrapper)).toBe(true)

    state.mediaKind.value = 'audiobook'
    await wrapper.vm.$nextTick()

    expect(blockingHint(wrapper)).toBe(false)
    expect(wrapper.get('#request-library').text()).toContain('Default (Audiobooks)')
  })
})

/**
 * The escape hatch for a work no metadata provider carries. Gated twice over: only after a search
 * that found nothing, and only for somebody who will pick the release themselves, because an
 * approver handed a row that says nothing but a typed string cannot tell what was meant.
 */
describe('RequestSearchPanel free-text fallback', () => {
  const ACTION = 'Search indexers'

  beforeEach(() => {
    vi.clearAllMocks()
    state.mediaKind.value = 'ebook'
    state.libraries.value = [{ id: 4, name: 'Novels', folders: [{ id: 9, path: '/books' }] }]
    state.defaultFor.mockReturnValue({ libraryId: 4, libraryName: 'Novels', folderId: 9 })
    state.hasSearched.value = true
    state.checkFreeText.mockResolvedValue(null)
    state.hasPermission.mockImplementation((permission: string) => permission === Permission.BookRequestSelfFulfill)
  })

  /** Past the hint debounce, then let its promise resolve. */
  async function settleHint(wrapper: Awaited<ReturnType<typeof render>>) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  async function typeTitle(wrapper: Awaited<ReturnType<typeof render>>, value = 'An Untracked Novel') {
    await wrapper.find('#request-title').setValue(value)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return wrapper
  }

  it('offers a direct indexer search once a provider search comes back empty', async () => {
    const wrapper = await typeTitle(await render())
    expect(wrapper.text()).toContain(ACTION)
  })

  it('never offers it to somebody who cannot fulfil their own requests', async () => {
    state.hasPermission.mockReturnValue(false)

    const wrapper = await typeTitle(await render())
    expect(wrapper.text()).not.toContain(ACTION)
  })

  it('does not offer it before a search has been run', async () => {
    state.hasSearched.value = false

    const wrapper = await typeTitle(await render())
    expect(wrapper.text()).not.toContain(ACTION)
  })

  it('says what the library already has, before anything is created', async () => {
    state.checkFreeText.mockResolvedValue({ ownedBookId: 12, existingRequestId: null, alreadySubscribed: false })

    const wrapper = await typeTitle(await render())
    await settleHint(wrapper)

    expect(wrapper.text()).toContain('Already in your library')
    expect(state.submitFreeText).not.toHaveBeenCalled()
  })

  /**
   * The empty state stays on screen while somebody keeps typing, so an unthrottled hint asked the
   * server once per keystroke.
   */
  it('asks about the typed text once, not once per keystroke', async () => {
    state.checkFreeText.mockResolvedValue(null)
    const wrapper = await render()

    for (const value of ['A', 'An', 'An U', 'An Untracked Novel']) {
      await wrapper.find('#request-title').setValue(value)
    }
    await settleHint(wrapper)

    expect(state.checkFreeText).toHaveBeenCalledTimes(1)
    expect(state.checkFreeText).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'An Untracked Novel' }))
  })

  /**
   * The refusals this endpoint raises are copy this application wrote about rules this instance
   * applies, so they have to arrive translated. The server sentence stays only for what nothing
   * classified, which is what makes the generic fallback the last resort rather than the norm.
   */
  it('shows the translated refusal rather than the English sentence beside it', async () => {
    state.submitFreeText.mockResolvedValue(null)
    state.lastFailure.value = {
      code: 'SUBMIT_SELF_SERVE_LIMIT',
      meta: { limit: 10 },
      message: 'Finish or cancel some downloads first: 10 can be in flight at once',
    }

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.toastError).toHaveBeenCalledWith('Finish or cancel some downloads first: you can have 10 in flight at once')
    expect(state.push).not.toHaveBeenCalled()
  })

  it('falls back to its own message when the server classified nothing', async () => {
    state.submitFreeText.mockResolvedValue(null)
    state.lastFailure.value = null

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.toastError).toHaveBeenCalledWith('Could not submit that request')
  })

  it('creates a self-serve request and goes straight to the picker', async () => {
    state.submitFreeText.mockResolvedValue({ request: { id: 31, userId: 7, status: 'approved' }, subscribed: false })

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.submitFreeText).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'An Untracked Novel' }),
      expect.objectContaining({ selfServe: true }),
    )
    expect(state.push).toHaveBeenCalledWith({ name: 'book-request-releases', params: { id: 31 }, query: {} })
  })

  /** Somebody else is already fetching this work, so there is nothing of ours to pick a release for. */
  it("stays put when the request folds into somebody else's live one", async () => {
    state.submitFreeText.mockResolvedValue({ request: { id: 31, userId: 99, status: 'approved' }, subscribed: true })

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.push).not.toHaveBeenCalled()
  })

  /**
   * Pressing Download twice folds you into your *own* row, which still reports `subscribed`. Being
   * told you joined a queue you are already at the front of is wrong; ownership decides, not the flag.
   */
  it('returns you to your own picker when the work folds into a request you already own', async () => {
    state.submitFreeText.mockResolvedValue({ request: { id: 31, userId: 7, status: 'approved' }, subscribed: true })

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.push).toHaveBeenCalledWith({ name: 'book-request-releases', params: { id: 31 }, query: {} })
  })

  /**
   * One live request per work, so a self-fulfiller's submission cannot open a row beside somebody
   * else's: the server hands them that row instead, and the picker is where they were going.
   */
  it('goes to the picker for a request the server handed over to the caller', async () => {
    state.submitFreeText.mockResolvedValue({
      request: { id: 31, userId: 99, fulfillerUserId: 7, status: 'approved' },
      subscribed: true,
    })

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.push).toHaveBeenCalledWith({ name: 'book-request-releases', params: { id: 31 }, query: {} })
  })

  /** Somebody else took it on, so the requester it names is no longer the one driving it either. */
  it('stays put on a request somebody else was handed', async () => {
    state.submitFreeText.mockResolvedValue({
      request: { id: 31, userId: 7, fulfillerUserId: 99, status: 'approved' },
      subscribed: true,
    })

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.push).not.toHaveBeenCalled()
  })

  /** A settled row has no picker to return to, so folding into one is just a subscription. */
  it('does not send you to a picker for a request that already finished', async () => {
    state.submitFreeText.mockResolvedValue({ request: { id: 31, userId: 7, status: 'available' }, subscribed: true })

    const wrapper = await typeTitle(await render())
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(ACTION))!
      .trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.push).not.toHaveBeenCalled()
  })
})
