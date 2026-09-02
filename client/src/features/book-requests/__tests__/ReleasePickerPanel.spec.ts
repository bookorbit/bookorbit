import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission } from '@bookorbit/types'
import type { BookRequestItem, IndexerSearchStatus, ReleaseCandidateItem } from '@bookorbit/types'

const api = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (...args: [string, RequestInit?]) => api(...args) }))
// The panel reads whether the viewer moderates the queue, which decides whether it asks the admin
// or the self-fulfil endpoint. Stubbed rather than pulled in: the real composable reaches `useAuth`,
// which builds the router at module scope.
const hasPermission = vi.fn<(permission: string) => boolean>()
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (permission: string) => hasPermission(permission) }),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '7' }, query: {} }),
  useRouter: () => ({ push: vi.fn<() => void>() }),
}))

import ReleasePickerPanel from '../components/ReleasePickerPanel.vue'

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 7,
    userId: 1,
    requesterUsername: 'neon',
    requesterName: 'Neon',
    mediaKind: 'ebook',
    status: 'approved',
    preferredFormats: ['epub'],
    note: null,
    targetLibraryId: 1,
    targetLibraryName: 'Books',
    targetFolderId: null,
    decidedByUserId: null,
    decidedByUsername: null,
    decidedAt: null,
    decisionNote: null,
    matchedBookId: null,
    bookDockFileId: null,
    selfServe: false,
    fulfillerUserId: null,
    statusReason: null,
    failureCode: null,
    failureMeta: null,
    subscribers: [],
    download: null,
    dismissed: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    title: 'Spark of the Everflame',
    subtitle: null,
    authors: ['Penn Cole'],
    seriesName: null,
    seriesIndex: null,
    isbn10: null,
    isbn13: null,
    publishedYear: 2024,
    language: null,
    coverUrl: null,
    providerKey: null,
    providerId: null,
    metadataSources: [],
    ...overrides,
  }
}

function release(overrides: Partial<ReleaseCandidateItem> = {}): ReleaseCandidateItem {
  return {
    indexerId: 1,
    indexerName: 'MyAnonaMouse',
    guid: 'g1',
    title: 'Spark of the Everflame',
    sizeBytes: 3_100_000,
    seeders: 506,
    leechers: 2,
    format: 'epub',
    formats: ['epub', 'azw3', 'mobi'],
    language: 'ENG',
    fileCount: null,
    freeleech: false,
    vipOnly: false,
    alreadyGrabbed: false,
    publishedAt: '2023-08-05T00:00:00.000Z',
    audio: null,
    score: 89,
    tier: null,
    tierName: null,
    reasons: [{ code: 'titleMatch', points: 55 }],
    ...overrides,
  }
}

function audio(bitrateKbps: number) {
  return { bitrateKbps, bitrateMode: 'CBR', channels: 2, samplingRateHz: 44100, durationSeconds: 3600, chapterCount: null }
}

function status(overrides: Partial<IndexerSearchStatus> = {}): IndexerSearchStatus {
  return {
    indexerId: 1,
    indexerName: 'MyAnonaMouse',
    color: null,
    ok: true,
    count: 1,
    filtered: 0,
    query: { kind: 'titleAuthor', value: 'Spark of the Everflame Penn Cole' },
    seedsBack: true,
    ...overrides,
  }
}

/** A tracker release and a plain HTTP library release, which is the mix that exposed the bugs. */
const MIXED = {
  releases: [release(), release({ indexerId: 2, indexerName: 'Library Genesis', guid: 'g2', seeders: null, format: 'epub', formats: ['epub'] })],
  criteria: {
    title: 'Spark of the Everflame',
    authors: ['Penn Cole'],
    isbn10: '1234567890',
    isbn13: '9781234567897',
    activeIsbn: '9781234567897',
    isbns: ['9781234567897'],
    mediaKind: 'ebook',
    language: 'en',
    preferredFormats: ['epub'],
  },
  indexers: [
    status(),
    status({
      indexerId: 2,
      indexerName: 'Library Genesis',
      query: { kind: 'isbn', value: '9781234567897' },
      seedsBack: false,
    }),
  ],
  uncoveredIndexerCount: 0,
  enabledIndexerCount: 2,
  configuredIndexerCount: 2,
  profileActive: false,
  searchedAt: '2026-08-20T00:00:00.000Z',
  cached: false,
}

function respond(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}

function refuse(body: unknown) {
  return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve(body) } as Response)
}

/** Whatever the picker asks about a release's files, so a click reaches the grab it is testing. */
const READY_INSPECTION = {
  source: 'torrent_file',
  status: 'ready',
  files: [{ path: 'book.epub', sizeBytes: 100, bookFile: true }],
  totalFiles: 1,
  primaryFileCount: 1,
  truncated: false,
  units: [],
  unitCount: 1,
  ignoredFileCount: 0,
  containerCount: 0,
}

/** The release list, not the source transcript above it: both are lists, so both hold `li`. */
function releaseRows(wrapper: VueWrapper): DOMWrapper<Element>[] {
  return wrapper.findAll('ul[aria-label="Every other release, ranked"] > li')
}

function changeSearch(wrapper: VueWrapper): DOMWrapper<Element> {
  return wrapper.findAll('button').find((button) => button.text().includes('Change search'))!
}

function editFields(wrapper: VueWrapper): DOMWrapper<Element> {
  return wrapper.findAll('button').find((button) => button.text().includes('Edit fields'))!
}

async function render(search: unknown = MIXED) {
  api.mockImplementation((input: string) => {
    if (input.includes('/releases')) return respond(search)
    if (input.includes('download-clients')) return respond([])
    return respond(request())
  })

  const wrapper = mount(ReleasePickerPanel, { global: { stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.mockReset()
  // A moderator by default, which is the path every existing case in this file was written against.
  hasPermission.mockReturnValue(true)
})

describe('ReleasePickerPanel', () => {
  it('states the searched key once, and what every source did with it', async () => {
    const wrapper = await render()
    const panel = wrapper.get('section[aria-label="Active search"]')
    const sources = panel.get('ul[aria-label="Sources"]').text()

    expect(panel.text()).toContain('Searched9781234567897')
    // The source that was handed the same key says so rather than repeating the digits.
    expect(sources).toContain('Library Genesissearched the ISBN')
    expect(sources).toContain('1 release')
    // The one that could not take an ISBN shows the string it was actually sent.
    expect(sources).toContain('MyAnonaMouseSpark of the Everflame Penn Cole')
  })

  it('counts the releases a source had dropped by the hard filters', async () => {
    const wrapper = await render({
      ...MIXED,
      indexers: [MIXED.indexers[0], { ...MIXED.indexers[1], count: 0, filtered: 3 }],
    })

    const sources = wrapper.get('ul[aria-label="Sources"]').text()
    expect(sources).toContain('3 filtered out')
    expect(sources).toContain('no matches')
  })

  it('names a source that failed and offers the one fix a re-run cannot make', async () => {
    const wrapper = await render({
      ...MIXED,
      indexers: [MIXED.indexers[0], { ...MIXED.indexers[1], ok: false, count: 0, failure: 'unauthorized' }],
    })

    const sources = wrapper.get('ul[aria-label="Sources"]')
    expect(sources.text()).toContain('sign-in expired')
    expect(sources.text()).toContain('Fix in settings')
    expect(sources.findComponent(RouterLinkStub).props('to')).toEqual({ name: 'settings-admin-requests' })
  })

  it('keeps the search options shut while a search is returning releases', async () => {
    const wrapper = await render({
      ...MIXED,
      criteria: { ...MIXED.criteria, isbns: ['9781234567897', '9781250301697'] },
    })

    expect(wrapper.find('#release-search-options').exists()).toBe(false)
    await changeSearch(wrapper).trigger('click')

    const options = wrapper.get('#release-search-options').text()
    expect(options).toContain('Search this instead')
    expect(options).toContain('9781250301697')
    expect(options).toContain('Title and author')
    expect(options).toContain('Filtered locally:')
    expect(options).toContain('Media:E-book')
  })

  it('opens itself on a search that found nothing, and leads with the other keys', async () => {
    const wrapper = await render({
      ...MIXED,
      releases: [],
      criteria: { ...MIXED.criteria, isbns: ['9781234567897', '9781250301697'] },
      indexers: [{ ...MIXED.indexers[0], count: 0 }],
    })

    const panel = wrapper.get('section[aria-label="Active search"]')
    expect(panel.text()).toContain('Nothing found for 9781234567897')
    expect(wrapper.get('#release-search-options').text()).toContain('9781250301697')
    // The panel is the empty state now, so nothing repeats it under the list.
    expect(wrapper.text()).not.toContain('No release matched this request.')
  })

  /**
   * The reported bug: with nothing switched on the panel said "Nothing found for <isbn>", which
   * claims the ISBN was tried. No request was made, and the ISBN had no bearing on the outcome.
   */
  it('says nothing was searched rather than blaming the key when no source is enabled', async () => {
    const wrapper = await render({ ...MIXED, releases: [], indexers: [], enabledIndexerCount: 0, configuredIndexerCount: 0 })

    expect(wrapper.text()).not.toContain('Nothing found for')
    expect(wrapper.text()).not.toContain('Searched9781234567897')
    // The whole search transcript goes with it: its filters and alternate keys describe a search.
    expect(wrapper.find('section[aria-label="Active search"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No search sources are set up yet.')
    expect(wrapper.text()).toContain('Add a source')
  })

  it('offers to switch a source back on rather than to add one when they are all off', async () => {
    const wrapper = await render({ ...MIXED, releases: [], indexers: [], enabledIndexerCount: 0, configuredIndexerCount: 3 })

    expect(wrapper.text()).toContain('Every search source is switched off.')
    expect(wrapper.text()).toContain('Review sources')
    expect(wrapper.text()).not.toContain('Add a source')
  })

  /** Nobody who cannot open the settings page is sent to it, in copy or in a link. */
  it('tells a requester who to ask instead of linking them to settings they cannot open', async () => {
    hasPermission.mockImplementation((permission: string) => permission !== Permission.ManageAppSettings)
    const wrapper = await render({ ...MIXED, releases: [], indexers: [], enabledIndexerCount: 0, configuredIndexerCount: 0 })

    expect(wrapper.text()).toContain('Ask an administrator to set up a search source')
    expect(wrapper.text()).not.toContain('Add a source')
  })

  it('says what an alternative key returned once this visit has spent it', async () => {
    const wrapper = await render({
      ...MIXED,
      criteria: { ...MIXED.criteria, isbns: ['9781234567897', '9781250301697'] },
    })
    await changeSearch(wrapper).trigger('click')

    const alternative = wrapper.findAll('button').find((button) => button.text().includes('9781250301697'))!
    expect(alternative.text()).not.toContain('tried')

    api.mockImplementation(() =>
      respond({
        ...MIXED,
        releases: [],
        criteria: { ...MIXED.criteria, activeIsbn: '9781250301697', isbns: ['9781234567897', '9781250301697'] },
      }),
    )
    await alternative.trigger('click')
    await flushPromises()

    const spent = wrapper.findAll('button').find((button) => button.text().includes('9781234567897'))!
    expect(wrapper.findAll('button').find((button) => button.text().includes('9781250301697'))).toBeUndefined()
    expect(spent.text()).toContain('tried, 2 releases')
  })

  it('collapses the sources that have nothing to explain, and expands them on request', async () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      status({ indexerId: index + 10, indexerName: `Source ${index + 1}`, count: 2, query: { kind: 'isbn', value: '9781234567897' } }),
    )
    const wrapper = await render({ ...MIXED, indexers: [...many, status({ indexerId: 99, indexerName: 'Slow one', ok: false, failure: 'timeout' })] })

    const sources = wrapper.get('ul[aria-label="Sources"]')
    expect(sources.text()).toContain('6 sources searched')
    expect(sources.text()).toContain('12 releases')
    // A failure is never folded into a total: it is the reason the list is worth reading.
    expect(sources.text()).toContain('Slow one')
    expect(sources.text()).toContain('timed out')
    expect(sources.text()).not.toContain('Source 1')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Show each')!
      .trigger('click')
    expect(wrapper.get('ul[aria-label="Sources"]').text()).toContain('Source 1')
  })

  it('lets the user choose ISBNs and override every editable search field', async () => {
    const wrapper = await render()

    await changeSearch(wrapper).trigger('click')
    await editFields(wrapper).trigger('click')
    await wrapper.get('#release-search-title').setValue('Dune Messiah')
    await wrapper.get('#release-search-authors').setValue('Frank Herbert')
    await wrapper.get('#release-search-language').setValue('')
    await wrapper.get('#release-search-formats').setValue('azw3, epub')
    await wrapper.get('#release-search-custom-isbn').setValue('0593098234')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api).toHaveBeenCalledWith('/api/v1/admin/book-requests/7/releases/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Dune Messiah',
        authors: ['Frank Herbert'],
        isbn: '9780593098233',
        language: null,
        preferredFormats: ['azw3', 'epub'],
      }),
    })
  })

  it('can send no ISBNs and search only with manually edited text fields', async () => {
    const wrapper = await render()

    await changeSearch(wrapper).trigger('click')
    await editFields(wrapper).trigger('click')
    await wrapper.get('#release-search-without-isbn').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const customCall = api.mock.calls.find(([url]) => url.endsWith('/releases/search'))
    expect(JSON.parse(String(customCall?.[1]?.body))).toEqual(expect.objectContaining({ isbn: null }))
  })

  it('searches again with the currently displayed fields instead of reverting silently', async () => {
    const current = {
      ...MIXED,
      releases: [],
      criteria: {
        ...MIXED.criteria,
        title: 'A manual title',
        authors: ['A manual author'],
        isbn10: null,
        isbn13: null,
        activeIsbn: null,
        isbns: [],
        language: null,
        preferredFormats: ['azw3'],
      },
    }
    const wrapper = await render(current)

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Search again'))!
      .trigger('click')
    await flushPromises()

    const customCall = api.mock.calls.find(([url]) => url.endsWith('/releases/search'))
    expect(JSON.parse(String(customCall?.[1]?.body))).toEqual({
      title: 'A manual title',
      authors: ['A manual author'],
      isbn: null,
      language: null,
      preferredFormats: ['azw3'],
    })
  })

  it('keeps media visible as search context when no optional filters are set', async () => {
    const wrapper = await render({
      ...MIXED,
      criteria: { ...MIXED.criteria, isbn10: null, preferredFormats: [] },
    })
    await changeSearch(wrapper).trigger('click')

    expect(wrapper.get('[aria-labelledby="release-search-local-criteria"]').text()).toContain('Media:E-book')
    expect(wrapper.get('section[aria-label="Active search"]').text()).toContain('Searched9781234567897')
  })

  /**
   * The label that started this: MyAnonaMouse lists "azw3 epub mobi" alphabetically, so the row
   * read "AZW3" for a release that carries the requested EPUB.
   */
  it('labels a release with every format it carries, the requested one first', async () => {
    const text = (await render()).text()

    expect(text).toContain('EPUB + AZW3 + MOBI')
  })

  it('offers a format chip for every format a release carries, not just its first', async () => {
    const chips = (await render()).findAll('[aria-pressed]').map((chip) => chip.text())

    expect(chips.some((chip) => chip.startsWith('AZW3'))).toBe(true)
    expect(chips.some((chip) => chip.startsWith('MOBI'))).toBe(true)
  })

  /** Per-theme tokens, not one hex for both themes: the chip's own text is what carries the colour. */
  it('paints format chips from the shared per-theme format tokens', async () => {
    const wrapper = await render()
    const epub = wrapper.findAll('[aria-pressed]').find((chip) => chip.text().startsWith('EPUB'))

    expect(epub!.attributes('style')).toContain('color: var(--pill-format-epub)')
    expect(epub!.attributes('style')).toContain('background-color: color-mix(in oklch, var(--pill-format-epub) 10%, transparent)')
  })

  /** Filtering to EPUB used to hide the very release that carries one. */
  it('keeps a multi-format release under a filter on a format it carries', async () => {
    const wrapper = await render()
    const epub = wrapper.findAll('[aria-pressed]').find((chip) => chip.text().startsWith('EPUB'))
    await epub!.trigger('click')

    expect(releaseRows(wrapper).some((row) => row.text().includes('EPUB + AZW3 + MOBI'))).toBe(true)
  })

  /** A plain HTTP library has no swarm, so silence there is not a missing count. */
  it('says nothing about seeders for a source that serves the file itself', async () => {
    const rows = releaseRows(await render())
    const libgen = rows.find((row) => row.text().includes('Library Genesis'))

    expect(libgen!.text()).not.toContain('Seeders unknown')
    expect(libgen!.text()).toContain('Direct')
  })

  /**
   * The two chips carry different facts, and before this they carried the same hue: a scan down
   * the list could not tell a swarm row from a direct download without reading either one.
   */
  it('separates torrent and direct download by colour', async () => {
    const rows = releaseRows(await render())
    const chipClass = (row: (typeof rows)[number], label: string) =>
      row
        .findAll('span')
        .find((span) => span.text() === label)!
        .attributes('class')

    const tracker = rows.find((row) => row.text().includes('MyAnonaMouse'))!
    const libgen = rows.find((row) => row.text().includes('Library Genesis'))!

    expect(chipClass(tracker, 'Torrent')).toContain('--pill-torrent')
    expect(chipClass(libgen, 'Direct')).toContain('--pill-direct')
  })

  it('wears the colour the operator gave the source, and stays neutral for one with none', async () => {
    const search = { ...MIXED, indexers: [status({ color: 'orange' }), status({ indexerId: 2, indexerName: 'Library Genesis', seedsBack: false })] }
    const rows = releaseRows(await render(search))
    const chipClass = (row: (typeof rows)[number], name: string) =>
      row
        .findAll('span')
        .find((span) => span.text() === name)!
        .attributes('class')

    expect(
      chipClass(
        rows.find((row) => row.text().includes('MyAnonaMouse'))!,
        'MyAnonaMouse',
      ),
    ).toContain('--pill-source-orange')
    expect(
      chipClass(
        rows.find((row) => row.text().includes('Library Genesis'))!,
        'Library Genesis',
      ),
    ).toContain('text-muted-foreground')
  })

  it('uses the assigned source color when every release comes from one tracker', async () => {
    const search = {
      ...MIXED,
      releases: [release(), release({ guid: 'g2' })],
      indexers: [status({ color: 'orange', count: 2 })],
    }
    const wrapper = await render(search)
    const sourceSummary = wrapper.findAll('span').find((span) => span.text() === 'all from MyAnonaMouse')

    expect(sourceSummary?.classes().join(' ')).toContain('--pill-source-orange')
  })

  it('uses each source color on its indexer filter pill', async () => {
    const search = {
      ...MIXED,
      releases: [
        release({ indexerName: 'MAM' }),
        release({ indexerId: 2, indexerName: 'IPT', guid: 'g2' }),
        release({ indexerId: 3, indexerName: 'TL', guid: 'g3' }),
      ],
      indexers: [
        status({ indexerName: 'MAM', color: 'green' }),
        status({ indexerId: 2, indexerName: 'IPT', color: 'blue' }),
        status({ indexerId: 3, indexerName: 'TL', color: 'red' }),
      ],
    }
    const wrapper = await render(search)
    const buttons = wrapper.get('[aria-label="Indexer"]').findAll('button')
    const classesFor = (name: string) =>
      buttons
        .find((button) => button.text().startsWith(name))
        ?.classes()
        .join(' ')

    expect(classesFor('MAM')).toContain('--pill-source-green')
    expect(classesFor('IPT')).toContain('--pill-source-blue')
    expect(classesFor('TL')).toContain('--pill-source-red')
  })

  it('states the swarm on a tracker release', async () => {
    const rows = releaseRows(await render())
    const tracker = rows.find((row) => row.text().includes('MyAnonaMouse'))

    expect(tracker!.text()).toContain('506 seeders')
    expect(tracker!.text()).toContain('Torrent')
  })

  it('uses singular forms for one seeder and one chapter', async () => {
    const item = release({
      seeders: 1,
      audio: { ...audio(128), chapterCount: 1 },
    })
    const wrapper = await render({ ...MIXED, releases: [item], indexers: [status()] })

    expect(releaseRows(wrapper)[0].text()).toContain('1 seeder')
    expect(releaseRows(wrapper)[0].text()).toContain('1 chapter')
  })

  /** On a tracker, a missing count really is the release omitting one, and still worth saying. */
  /**
   * The failure this exists for: a tracker refusing one release refuses the rest of its list the
   * same way, so an approver should not have to click down them collecting the same 406.
   */
  it("rules out a source's remaining releases once it has refused one", async () => {
    const search = {
      ...MIXED,
      releases: [
        release({ guid: 'mam-1' }),
        release({ guid: 'mam-2', score: 85 }),
        release({ indexerId: 2, indexerName: 'Library Genesis', guid: 'libgen-1', seeders: null, score: 70 }),
      ],
    }
    api.mockImplementation((input: string) => {
      if (input.includes('/releases/inspect')) return respond(READY_INSPECTION)
      if (input.includes('/releases')) return respond(search)
      if (input.includes('download-clients')) return respond([])
      if (input.includes('/grab')) return refuse({ message: 'the tracker answered 406', errorCode: 'GRAB_SOURCE_REFUSED' })
      return respond(request())
    })

    const wrapper = mount(ReleasePickerPanel, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()

    const grabButton = (row: ReturnType<typeof wrapper.findAll>[number]) =>
      row.findAll('button').find((button) => /Download release|Send/.test(button.text()))!
    const rowFor = (guid: string) => releaseRows(wrapper)[search.releases.findIndex((item) => item.guid === guid)]!

    await grabButton(rowFor('mam-1')).trigger('click')
    await flushPromises()

    expect(rowFor('mam-2').text()).toContain('This source turned down an earlier release')
    expect(grabButton(rowFor('mam-2')).attributes('disabled')).toBeDefined()
    // The other source was never asked, so nothing has been established about it.
    expect(rowFor('libgen-1').text()).not.toContain('turned down')
    expect(grabButton(rowFor('libgen-1')).attributes('disabled')).toBeUndefined()
  })

  it('still reports an unknown count on a swarm source', async () => {
    const wrapper = await render({
      ...MIXED,
      releases: [release({ seeders: null })],
      indexers: [status()],
    })

    expect(wrapper.text()).toContain('Seeders unknown')
  })

  /**
   * The gap this set closes: the tracker states `numfiles` on every row and it used to stop at a
   * scoring penalty, so an approver could not tell one M4B from a forty-part MP3 set without
   * expanding each row, which costs a credentialed fetch per release.
   */
  describe('file count', () => {
    const AUDIO = {
      ...MIXED,
      releases: [
        release({ guid: 'one', title: 'One file m4b', formats: ['m4b'], format: 'm4b', fileCount: 1 }),
        release({ guid: 'many', title: 'Chaptered mp3', formats: ['mp3'], format: 'mp3', fileCount: 32 }),
      ],
      indexers: [status()],
    }

    it('states the file count on the row', async () => {
      const text = (await render(AUDIO)).text()

      expect(text).toContain('1 file')
      expect(text).toContain('32 files')
    })

    it('says nothing where the source stated no count', async () => {
      const wrapper = await render({ ...MIXED, releases: [release({ fileCount: null })], indexers: [status()] })

      // Matched on the count itself: the panel says "View files" regardless, so a bare substring
      // check on "file" would pass whether the fact was rendered or not.
      expect(releaseRows(wrapper)[0].text()).not.toMatch(/\d+ files?/)
    })

    it('filters to a single file', async () => {
      const wrapper = await render(AUDIO)
      const chip = wrapper.findAll('[aria-pressed]').find((option) => option.text().startsWith('One book file'))
      await chip!.trigger('click')

      const rows = releaseRows(wrapper).map((row) => row.text())
      expect(rows.some((row) => row.includes('One file m4b'))).toBe(true)
      expect(rows.some((row) => row.includes('Chaptered mp3'))).toBe(false)
    })

    /** A release whose source stated no count is not a single file, so neither chip may claim it. */
    it('leaves an unstated count out of both choices', async () => {
      const wrapper = await render({
        ...AUDIO,
        releases: [...AUDIO.releases, release({ guid: 'silent', title: 'Unstated', fileCount: null })],
      })
      const chip = wrapper.findAll('[aria-pressed]').find((option) => option.text().startsWith('Several files'))
      await chip!.trigger('click')

      expect(releaseRows(wrapper).some((row) => row.text().includes('Unstated'))).toBe(false)
    })
  })

  describe('VIP-only releases', () => {
    const WITH_VIP = {
      ...MIXED,
      releases: [release({ guid: 'open', title: 'Open release' }), release({ guid: 'vip', title: 'Locked release', vipOnly: true })],
      indexers: [status()],
    }

    /** These rows are dead ends for a non-VIP account, and today cost a grab to find that out. */
    it('hides VIP-only releases on request', async () => {
      const wrapper = await render(WITH_VIP)
      const chip = wrapper.findAll('[aria-pressed]').find((option) => option.text().startsWith('Hide VIP only'))
      await chip!.trigger('click')

      const rows = releaseRows(wrapper).map((row) => row.text())
      expect(rows.some((row) => row.includes('Open release'))).toBe(true)
      expect(rows.some((row) => row.includes('Locked release'))).toBe(false)
    })

    it('offers no such toggle when no release is VIP-only', async () => {
      const wrapper = await render({ ...MIXED, releases: [release()], indexers: [status()] })

      expect(wrapper.findAll('[aria-pressed]').some((option) => option.text().startsWith('Hide VIP only'))).toBe(false)
    })
  })

  it('filters to one source when several answered', async () => {
    const wrapper = await render()
    const chip = wrapper.findAll('[aria-pressed]').find((option) => option.text().startsWith('Library Genesis'))
    await chip!.trigger('click')

    expect(releaseRows(wrapper)).toHaveLength(1)
    expect(releaseRows(wrapper)[0].text()).toContain('Library Genesis')
  })

  describe('bitrate floor', () => {
    const ENCODES = {
      ...MIXED,
      releases: [
        release({ guid: 'low', title: 'Sixty four', audio: audio(64) }),
        release({ guid: 'high', title: 'One twenty eight', audio: audio(128) }),
      ],
      indexers: [status()],
    }

    it('keeps only encodes at or above the floor', async () => {
      const wrapper = await render(ENCODES)
      const chip = wrapper.findAll('[aria-pressed]').find((option) => option.text().startsWith('96k+'))
      await chip!.trigger('click')

      const rows = releaseRows(wrapper).map((row) => row.text())
      expect(rows.some((row) => row.includes('One twenty eight'))).toBe(true)
      expect(rows.some((row) => row.includes('Sixty four'))).toBe(false)
    })

    /** A step every release clears sorts nothing, and one none clears can only empty the list. */
    it('offers no step that every release already clears', async () => {
      const wrapper = await render({
        ...ENCODES,
        releases: [release({ guid: 'a', audio: audio(128) }), release({ guid: 'b', audio: audio(192) })],
      })

      expect(wrapper.findAll('[aria-pressed]').some((option) => option.text().startsWith('64k+'))).toBe(false)
    })
  })

  describe('profile tiers', () => {
    const TIERED = {
      ...MIXED,
      releases: [
        release({ guid: 'untiered', title: 'Untiered but strong', score: 95, tier: null, tierName: null }),
        release({ guid: 'tiered', title: 'Tiered but weaker', score: 60, tier: 0, tierName: 'M4B single file' }),
      ],
      indexers: [status()],
    }

    it('names the tier on the row', async () => {
      expect((await render(TIERED)).text()).toContain('M4B single file')
    })

    /**
     * The whole point of tier being its own axis: the operator said which edition they want, and a
     * higher score on something they did not ask for must not reorder that.
     */
    it('puts a tiered release above a better-scoring untiered one', async () => {
      const rows = releaseRows(await render(TIERED))

      expect(rows[0].text()).toContain('Tiered but weaker')
      expect(rows[1].text()).toContain('Untiered but strong')
    })
  })
})
