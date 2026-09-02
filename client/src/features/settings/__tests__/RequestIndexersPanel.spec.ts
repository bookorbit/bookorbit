import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INDEXER_COLORS, type IndexerAdapterDescriptor, type IndexerItem } from '@bookorbit/types'

const { apiMock, toastMock, superuser } = vi.hoisted(() => ({
  superuser: { value: true },
  apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  toastMock: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() },
}))

/**
 * Superuser by default, since the install controls are the part gated on it. The factory builds a
 * real computed rather than handing back a plain object: the template unwraps a ref and would treat
 * `{ value: false }` as simply truthy.
 */
vi.mock('@/features/auth/composables/usePermissions', async () => {
  const { computed } = await import('vue')
  return { usePermissions: () => ({ isSuperuser: computed(() => superuser.value), hasPermission: () => true }) }
})
vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: toastMock }))

import RequestIndexersPanel from '../RequestIndexersPanel.vue'

let mounted: VueWrapper | null = null
const PATH = '/api/v1/admin/request-indexers'

function descriptor(overrides: Partial<IndexerAdapterDescriptor> = {}): IndexerAdapterDescriptor {
  return {
    type: 'torznab',
    label: 'Torznab',
    builtIn: true,
    requiresCredential: false,
    credentialKind: 'apiKey',
    mediaKinds: ['ebook', 'audiobook', 'comic'],
    usesCategories: true,
    seedsBack: true,
    supportsIsbnSearch: false,
    defaultCategories: { ebook: [7020], audiobook: [3030], comic: [7030] },
    settingsFields: [],
    ...overrides,
  }
}

/**
 * An open library: no credential, no categories, nothing seeded back, and an address of its own.
 * A plugin rather than a built-in, because torznab is the only built-in and it is the opposite of
 * this on every one of those.
 */
const OPEN_LIBRARY = descriptor({
  type: 'open-library',
  label: 'Open Library',
  builtIn: false,
  credentialKind: null,
  mediaKinds: ['ebook'],
  usesCategories: false,
  seedsBack: false,
  defaultCategories: { ebook: [], audiobook: [], comic: [] },
  defaultBaseUrl: 'https://openlibrary.example',
})

/** What an adapter loaded from the plugin directory looks like to the form. */
const PLUGIN = descriptor({
  type: 'demo-tracker',
  label: 'Demo Tracker',
  builtIn: false,
  version: '2.4.1',
  requiresCredential: true,
  credentialKind: 'sessionId',
  baseUrlHint: "The tracker's own address.",
  settingsFields: [
    { key: 'preferFlac', type: 'boolean', label: 'Prefer FLAC', default: true },
    {
      key: 'formats',
      type: 'string',
      format: 'list',
      label: 'Formats',
      default: 'epub,mobi',
      options: ['epub', 'mobi', 'pdf'],
      minItems: 1,
    },
  ],
})

function indexer(overrides: Partial<IndexerItem> = {}): IndexerItem {
  return {
    id: 1,
    name: 'My Prowlarr',
    color: null,
    adapterType: 'torznab',
    enabled: true,
    baseUrl: 'http://127.0.0.1:9696/1',
    hasCredential: true,
    allowPrivateAddress: true,
    categories: { ebook: [7020], audiobook: [3030], comic: [7030] },
    disabledMediaKinds: [],
    isbnSearchDisabled: false,
    settings: {},
    networkProfile: null,
    lastTestedAt: null,
    lastTestOk: null,
    lastErrorMessage: null,
    lastSearchAt: null,
    lastSearchOk: null,
    lastSearchError: null,
    searchFailureStreak: 0,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * The editor's own actions live in a menu that opens on a pointer gesture jsdom does not raise, so
 * its content is rendered flat. What that costs is the open/closed state, which is reka's to get
 * right rather than this file's.
 */
const DROPDOWN_STUBS = {
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div><slot /></div>' },
  DropdownMenuItem: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
  DropdownMenuSeparator: { template: '<hr />' },
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) } as unknown as Response
}

async function mountPanel(
  options: { indexers?: IndexerItem[]; adapters?: IndexerAdapterDescriptor[]; pluginFailures?: Array<{ directory: string; reason: string }> } = {},
) {
  const { indexers = [], adapters = [descriptor(), OPEN_LIBRARY], pluginFailures = [] } = options
  apiMock.mockImplementation((url: string) =>
    Promise.resolve(url.endsWith('/adapters') ? response({ adapters, pluginFailures }) : response({ indexers, encryptionConfigured: true })),
  )
  const wrapper = mount(RequestIndexersPanel, { global: { stubs: DROPDOWN_STUBS } })
  mounted = wrapper
  await flushPromises()
  return wrapper
}

/** The editor renders through DialogPortal, so it lands on the body rather than in the wrapper. */
function sheet(): HTMLElement {
  const el = document.body.querySelector('[role="dialog"]')
  if (el === null) throw new Error('no editor sheet is open')
  return el as HTMLElement
}

/** Text or accessible name: a row's repeated controls are icons rather than labelled buttons. */
function nameOf(button: HTMLButtonElement): string {
  const text = (button.textContent ?? '').trim()
  return text || (button.getAttribute('aria-label') ?? '')
}

/** The plugin removal question, which is a dialog on the page rather than part of the editor. */
function confirmDialog(): HTMLElement {
  const dialog = [...document.body.querySelectorAll('[role="dialog"]')].find((el) => (el.textContent ?? '').includes('plugin?'))
  if (dialog === undefined) throw new Error('no plugin removal question is open')
  return dialog as HTMLElement
}

function clickInConfirm(text: string) {
  const button = [...confirmDialog().querySelectorAll('button')].find((candidate) => nameOf(candidate).includes(text))
  if (button === undefined) throw new Error(`the question offers no answer labelled "${text}"`)
  button.click()
}

function clickInSheet(text: string) {
  const button = [...sheet().querySelectorAll('button')].find((candidate) => nameOf(candidate).includes(text))
  if (button === undefined) throw new Error(`no button labelled "${text}" in the sheet`)
  button.click()
}

async function clickInPanel(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => nameOf(candidate.element as HTMLButtonElement).includes(text))
  if (button === undefined) throw new Error(`no button labelled "${text}" in the panel`)
  await button.trigger('click')
  await flushPromises()
}

function typeInto(selector: string, value: string) {
  const input = sheet().querySelector<HTMLInputElement>(selector)
  if (input === null) throw new Error(`no field matching ${selector}`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Add now opens the type picker first, so reaching the form means choosing a type and going on. */
/**
 * Two ways in, because there are two things. Torznab is the only built-in, so adding an indexer
 * needs no choice; a plugin is set up from the row it already occupies.
 */
async function openCreate(wrapper: VueWrapper, type = 'torznab') {
  if (type === 'torznab') {
    await clickInPanel(wrapper, 'Add indexer')
    return
  }

  const row = wrapper.findAll('li').find((item) => item.text().includes(type))
  const button = row?.findAll('button').find((candidate) => candidate.text().includes('Set up'))
  if (button === undefined) throw new Error(`no set-up button for "${type}"`)
  await button.trigger('click')
  await flushPromises()
}

describe('RequestIndexersPanel', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    // Unmounted, not just wiped: a panel left mounted stays reactive and teleports its sheet back
    // into the body on the next render, where the following test finds it and reads it as its own.
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
  })

  /**
   * The adapter list is a runtime fact once adapters can be loaded from disk, so the form has to
   * ask rather than compile it in.
   */
  it('asks the server which adapters this install actually has', async () => {
    await mountPanel()

    expect(apiMock).toHaveBeenCalledWith(`${PATH}/adapters`)
  })

  /**
   * Choosing the type first is the point of the picker: a select inside the form rewrites base URL,
   * categories and every adapter setting under whatever has already been typed.
   */
  describe('installing a plugin', () => {
    const INSPECTION = {
      type: 'example-tracker',
      label: 'Example Tracker',
      requiresCredential: true,
      credentialKind: 'apiKey',
      mediaKinds: ['ebook'],
      usesCategories: true,
      seedsBack: true,
      settingsFields: [],
      source: 'export default { type: "example-tracker" };\n',
      replaces: false,
      active: true,
    }

    /** The panel picks a file through a hidden input; this is what the browser would hand it. */
    async function chooseFile(wrapper: VueWrapper, name = 'index.mjs') {
      const input = wrapper.find<HTMLInputElement>('input[type="file"]')
      Object.defineProperty(input.element, 'files', { value: [new File(['export default {}'], name)], configurable: true })
      await input.trigger('change')
      await flushPromises()
    }

    function respondWith(inspection: unknown, ok = true) {
      apiMock.mockImplementation((url: string) => {
        if (url.endsWith('/plugins/inspect') || url.endsWith('/plugins')) return Promise.resolve(response(inspection, ok))
        return Promise.resolve(
          url.endsWith('/adapters')
            ? response({ adapters: [descriptor()], pluginFailures: [] })
            : response({ indexers: [], encryptionConfigured: true }),
        )
      })
    }

    /** Installing a plugin runs its code in the server process, so it is not an ordinary admin action. */
    it('does not offer the control to someone who is not an administrator', async () => {
      superuser.value = false
      try {
        const wrapper = await mountPanel({
          adapters: [descriptor(), PLUGIN],
          indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker' })],
        })

        expect(wrapper.findAll('button').some((button) => button.text().includes('Install plugin'))).toBe(false)
        expect(wrapper.find('input[type="file"]').exists()).toBe(false)
        expect(wrapper.findAll('button').map((button) => nameOf(button.element as HTMLButtonElement))).not.toContain('Delete plugin')

        await clickInPanel(wrapper, 'Edit A tracker')
        expect([...sheet().querySelectorAll('button')].map(nameOf)).not.toContain('Delete plugin')
      } finally {
        superuser.value = true
      }
    })

    it('reads the file without installing it', async () => {
      const wrapper = await mountPanel()
      respondWith(INSPECTION)

      await chooseFile(wrapper)

      const posted = apiMock.mock.calls.map(([url]) => url)
      expect(posted).toContain(`${PATH}/plugins/inspect`)
      expect(posted).not.toContain(`${PATH}/plugins`)
    })

    /** The docs ask an operator to read a plugin before trusting it; the sheet makes that literal. */
    it('shows what the plugin declares and the code it will run', async () => {
      const wrapper = await mountPanel()
      respondWith(INSPECTION)

      await chooseFile(wrapper)

      expect(sheet().textContent).toContain('Example Tracker')
      expect(sheet().textContent).toContain('example-tracker')
      expect(sheet().querySelector('code')?.textContent).toBe(INSPECTION.source)
    })

    it('warns what installing one actually means', async () => {
      const wrapper = await mountPanel()
      respondWith(INSPECTION)

      await chooseFile(wrapper)

      expect(sheet().textContent).toContain('encryption key')
    })

    it('says when the install would replace one already there', async () => {
      const wrapper = await mountPanel()
      respondWith({ ...INSPECTION, replaces: true })

      await chooseFile(wrapper)

      expect(sheet().textContent).toContain('replaces')
    })

    /** Sent again rather than a token, so what was reviewed and what lands are the same bytes. */
    it('sends the file again on confirmation', async () => {
      const wrapper = await mountPanel()
      respondWith(INSPECTION)
      await chooseFile(wrapper)

      clickInSheet('Install plugin')
      await flushPromises()

      expect(apiMock.mock.calls.map(([url]) => url)).toContain(`${PATH}/plugins`)
    })

    /** This step runs code rather than saving a form, so it must not be labelled like a form. */
    it('names the action install rather than save', async () => {
      const wrapper = await mountPanel()
      respondWith(INSPECTION)

      await chooseFile(wrapper)

      const labels = [...sheet().querySelectorAll('button')].map((button) => button.textContent?.trim())
      expect(labels).toContain('Install plugin')
      expect(labels).not.toContain('Save')
    })

    /**
     * A plugin is loaded into the running server as it is written, so the usual install asks for
     * nothing further. Telling every operator to restart trains them to ignore the one time it matters.
     */
    it('asks for no restart when the server loaded the plugin', async () => {
      const wrapper = await mountPanel()
      respondWith({ ...INSPECTION, active: true })
      await chooseFile(wrapper)

      clickInSheet('Install plugin')
      await flushPromises()

      expect(wrapper.text()).not.toContain('Restart BookOrbit')
    })

    /** The file landed but would not load here, which is the one case a restart can still fix. */
    it('says a restart is needed when the server could not load it', async () => {
      const wrapper = await mountPanel()
      respondWith({ ...INSPECTION, active: false })
      await chooseFile(wrapper)

      clickInSheet('Install plugin')
      await flushPromises()

      expect(wrapper.text()).toContain('Restart BookOrbit')
    })

    it('installs nothing when the file is refused', async () => {
      const wrapper = await mountPanel()
      respondWith({ message: 'That file is not a usable plugin: it declares no label' }, false)

      await chooseFile(wrapper)

      expect(() => sheet()).toThrow('no editor sheet is open')
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('no label'))
    })

    /**
     * A plugin and the source using it carry the same name, so the plugin is looked after from
     * inside that source rather than from a list of its own that reads like a duplicate.
     */
    describe('managing the plugin from the source that uses it', () => {
      const USING_PLUGIN = indexer({ adapterType: 'demo-tracker', name: 'A tracker' })

      function withPlugin(inspection: unknown, ok = true) {
        apiMock.mockImplementation((url: string) => {
          if (url.endsWith('/plugins/inspect') || url.endsWith('/plugins')) return Promise.resolve(response(inspection, ok))
          if (String(url).includes('/plugins/')) return Promise.resolve(response(null, ok))
          return Promise.resolve(
            url.endsWith('/adapters')
              ? response({ adapters: [descriptor(), PLUGIN], pluginFailures: [] })
              : response({ indexers: [USING_PLUGIN], encryptionConfigured: true }),
          )
        })
      }

      async function openDrawer(wrapper: VueWrapper) {
        await clickInPanel(wrapper, 'Edit A tracker')
      }

      /** The plugin is managed from the row it occupies, next to the source that runs it. */
      it('offers update and remove on the plugin row, and not on a torznab one', async () => {
        const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: [USING_PLUGIN, indexer({ id: 2, name: 'Plain' })] })

        const rowNames = (name: string) => {
          const row = wrapper.findAll('li').find((item) => item.text().includes(name))
          return row === undefined ? [] : row.findAll('button').map((button) => nameOf(button.element as HTMLButtonElement))
        }

        expect(rowNames('A tracker')).toEqual(expect.arrayContaining(['Update plugin', 'Delete plugin']))
        expect(rowNames('Plain')).not.toContain('Delete plugin')
      })

      /** In the editor the plugin is a fact about the source, not a second form inside its form. */
      it('states the plugin in the editor without giving it buttons of its own', async () => {
        const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: [USING_PLUGIN] })

        await openDrawer(wrapper)

        const section = [...sheet().querySelectorAll('section')].pop()
        expect(section?.textContent).toContain('used by 1 source')
        expect(section?.querySelectorAll('button')).toHaveLength(0)
      })

      it('reviews a chosen file as a replacement', async () => {
        const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: [USING_PLUGIN] })
        withPlugin({ ...INSPECTION, type: 'demo-tracker', label: 'Demo Tracker', replaces: true })

        await clickInPanel(wrapper, 'Update plugin')
        await chooseFile(wrapper)

        expect(sheet().textContent).toContain('Replace this plugin?')
      })

      /** Otherwise updating one plugin from the wrong file quietly installs a different one. */
      it('refuses a file that declares a different plugin', async () => {
        const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: [USING_PLUGIN] })
        withPlugin({ ...INSPECTION, type: 'something-else', replaces: false })

        await clickInPanel(wrapper, 'Update plugin')
        await chooseFile(wrapper)

        expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('something-else'))
        expect(apiMock.mock.calls.map(([url]) => url)).not.toContain(`${PATH}/plugins`)
      })

      /** Removing one plugin also deletes every source and credential configured for its type. */
      it('asks before deleting the plugin, and states that all of its sources are deleted', async () => {
        const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: [USING_PLUGIN] })
        withPlugin(null)

        await clickInPanel(wrapper, 'Delete plugin')
        expect(apiMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
        expect(confirmDialog().textContent).toContain('1 source and its saved settings and credential will be permanently deleted')

        clickInConfirm('Delete plugin')
        await flushPromises()

        expect(apiMock).toHaveBeenCalledWith(`${PATH}/plugins/demo-tracker`, expect.objectContaining({ method: 'DELETE' }))
        expect(toastMock.success).toHaveBeenCalledWith('Deleted demo-tracker and its sources.')
      })
    })

    /** An installed plugin nothing uses searches nothing, which the row has to say. */
    it('lists an installed plugin that was never filled in, and offers to do it', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN] })

      expect(wrapper.text()).toContain('Not set up yet')
      await clickInPanel(wrapper, 'Set up')

      expect(sheet().querySelector<HTMLInputElement>('#indexer-name')?.value).toBe('Demo Tracker')
    })

    /** Once something uses it, it is that source, and a second row for it would be a duplicate. */
    it('stops listing it separately once a source uses it', async () => {
      const wrapper = await mountPanel({
        adapters: [descriptor(), PLUGIN],
        indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker' })],
      })

      expect(wrapper.text()).not.toContain('Not set up yet')
    })

    /** Every delete surface for a plugin-backed row has the same plugin-wide consequence. */
    it('deletes the whole plugin from its row and from its source editor', async () => {
      const wrapper = await mountPanel({
        adapters: [descriptor(), PLUGIN],
        indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker' })],
      })

      const panelNames = wrapper.findAll('button').map((button) => nameOf(button.element as HTMLButtonElement))
      expect(panelNames).toContain('Delete plugin')
      expect(panelNames).not.toContain('Delete source')

      await clickInPanel(wrapper, 'Edit A tracker')

      const sheetNames = [...sheet().querySelectorAll('button')].map(nameOf)
      expect(sheetNames).toContain('Delete plugin')
      expect(sheetNames).not.toContain('Delete source')

      clickInSheet('Delete plugin')
      await flushPromises()
      expect(sheet().textContent).toContain('saved settings and credential will be permanently deleted')

      clickInSheet('Delete plugin')
      await flushPromises()

      expect(apiMock).toHaveBeenCalledWith(`${PATH}/plugins/demo-tracker`, expect.objectContaining({ method: 'DELETE' }))
    })

    it('keeps source-only deletion for built-in Torznab sources', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()], indexers: [indexer({ name: 'My Torznab' })] })

      await clickInPanel(wrapper, 'Edit My Torznab')

      const sheetNames = [...sheet().querySelectorAll('button')].map(nameOf)
      expect(sheetNames).toContain('Delete source')
      expect(sheetNames).not.toContain('Delete plugin')
    })
  })

  /**
   * A fresh install. Two empty groups are two headings with nothing to head, and the page they made
   * said "no plugin installed" and "no indexer yet" without ever saying what that costs.
   */
  describe('with nothing configured at all', () => {
    it('links administrators to the open library plugin collection', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()] })

      const link = wrapper.get('a[href="https://github.com/orbit-plugins/bookorbit-open-plugins"]')
      expect(link.text()).toContain('Browse open library plugins')
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
    })

    it('replaces both groups with one panel that says searching finds nothing', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()] })

      expect(wrapper.find('section[aria-labelledby="request-plugins-heading"]').exists()).toBe(false)
      expect(wrapper.find('section[aria-labelledby="request-indexers-heading"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('No sources yet')
      expect(wrapper.text()).toContain('a request search finds nothing')
    })

    /** The two ways in are the two groups it replaced, so both have to be reachable from it. */
    it('offers both ways in, and opens the torznab form from its own button', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()] })

      const names = wrapper.findAll('button').map((button) => nameOf(button.element as HTMLButtonElement))
      expect(names).toContain('Install plugin')
      expect(names).toContain('Add indexer')

      await clickInPanel(wrapper, 'Add indexer')
      expect(sheet().querySelector('#indexer-name')).not.toBeNull()
    })

    /** A door nobody can open is worse than one door: the copy stops promising two, as well. */
    it('leaves out the plugin door for someone who is not an administrator', async () => {
      superuser.value = false
      try {
        const wrapper = await mountPanel({ adapters: [descriptor()] })

        expect(wrapper.text()).toContain('No sources yet')
        expect(wrapper.text()).not.toContain('There are two ways in')
        expect(wrapper.findAll('button').map((button) => nameOf(button.element as HTMLButtonElement))).not.toContain('Install plugin')
        expect(wrapper.find('a[href="https://github.com/orbit-plugins/bookorbit-open-plugins"]').exists()).toBe(false)
      } finally {
        superuser.value = true
      }
    })

    /** A plugin that would not load is the one row somebody has to act on, so it is not "nothing". */
    it('keeps the groups when a plugin failed to load', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()], pluginFailures: [{ directory: 'busted', reason: 'boom' }] })

      expect(wrapper.text()).not.toContain('No sources yet')
      expect(wrapper.find('section[aria-labelledby="request-plugins-heading"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('busted')
    })
  })

  /**
   * The common state once anything exists. A second full-height panel would compete with a real
   * list, so the group that is still empty keeps its heading and says so on one line.
   */
  it('states an empty group on one line, with its action on that line rather than twice', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker' })] })

    const torznab = wrapper.find('section[aria-labelledby="request-indexers-heading"]')
    expect(torznab.text()).toContain('No indexer yet.')
    expect(torznab.findAll('button').filter((button) => button.text().includes('Add indexer'))).toHaveLength(1)
  })

  /**
   * Two groups, because there are two things. Torznab is the only built-in, so adding an indexer
   * asks nothing about which kind it is: that question only existed because plugins shared the list.
   */
  it('adds a torznab indexer without asking which kind it is', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor(), OPEN_LIBRARY, PLUGIN] })

    await clickInPanel(wrapper, 'Add indexer')

    expect(sheet().querySelector('input[name="indexer-adapter-type"]')).toBeNull()
    expect(sheet().querySelector('#indexer-name')).not.toBeNull()
    expect(sheet().textContent).toContain('torznab')
  })

  it('keeps plugins and torznab indexers in groups of their own', async () => {
    const wrapper = await mountPanel({
      adapters: [descriptor(), OPEN_LIBRARY, PLUGIN],
      indexers: [indexer({ name: 'My Prowlarr' })],
    })

    const group = (heading: string) => wrapper.find(`section[aria-labelledby="${heading}"]`).text()
    expect(group('request-plugins-heading')).toContain('Open Library')
    expect(group('request-plugins-heading')).toContain('Demo Tracker')
    expect(group('request-plugins-heading')).not.toContain('My Prowlarr')
    expect(group('request-indexers-heading')).toContain('My Prowlarr')
    expect(group('request-indexers-heading')).not.toContain('Demo Tracker')
  })

  it('shows the installed plugin version in the source row and editor header', async () => {
    const wrapper = await mountPanel({
      adapters: [descriptor(), PLUGIN],
      indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker' })],
    })

    const pluginGroup = wrapper.find('section[aria-labelledby="request-plugins-heading"]')
    expect(pluginGroup.text()).toContain('v2.4.1')
    expect(pluginGroup.find('[aria-label="Plugin version 2.4.1"]').exists()).toBe(true)

    await clickInPanel(wrapper, 'Edit A tracker')

    expect(sheet().textContent).toContain('v2.4.1')
    expect(sheet().querySelector('[aria-label="Plugin version 2.4.1"]')).not.toBeNull()
  })

  it('marks a legacy plugin version as unknown in both places', async () => {
    const legacy = descriptor({ ...PLUGIN, version: undefined })
    const wrapper = await mountPanel({
      adapters: [descriptor(), legacy],
      indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker' })],
    })

    expect(wrapper.find('[aria-label="Plugin version unknown"]').text()).toBe('v?')
    await clickInPanel(wrapper, 'Edit A tracker')
    expect(sheet().querySelector('[aria-label="Plugin version unknown"]')?.textContent?.trim()).toBe('v?')
  })

  /** The collection is about plugins, so it sits inside that group rather than above both of them. */
  it('keeps the plugin collection link inside the plugins group once sources exist', async () => {
    const wrapper = await mountPanel({
      adapters: [descriptor(), PLUGIN],
      indexers: [indexer({ name: 'My Prowlarr' })],
    })

    const group = wrapper.get('section[aria-labelledby="request-plugins-heading"]')
    expect(group.get('a[href="https://github.com/orbit-plugins/bookorbit-open-plugins"]').text()).toContain('Browse open library plugins')
    expect(wrapper.findAll('a[href="https://github.com/orbit-plugins/bookorbit-open-plugins"]')).toHaveLength(1)
  })

  it('does not ask for a credential an adapter has no use for', async () => {
    const wrapper = await mountPanel({ adapters: [OPEN_LIBRARY] })
    await openCreate(wrapper, 'open-library')

    expect(sheet().querySelector('#indexer-credential')).toBeNull()
  })

  /** Categories are meaningless for a source that serves the file itself. */
  it('hides the category editor for a source that does not use it', async () => {
    const wrapper = await mountPanel({ adapters: [OPEN_LIBRARY] })
    await openCreate(wrapper, 'open-library')

    expect(sheet().querySelector('#indexer-categories-ebook')).toBeNull()
  })

  it('shows it for an adapter that does use it', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor()] })
    await openCreate(wrapper)

    expect(sheet().querySelector('#indexer-categories-ebook')).not.toBeNull()
  })

  /** A plugin declares its own fields, and the form has never heard of them at build time. */
  it('renders the settings fields an adapter declared', async () => {
    const wrapper = await mountPanel({ adapters: [PLUGIN] })
    await openCreate(wrapper, 'demo-tracker')

    expect(sheet().querySelector('#indexer-setting-preferFlac')).not.toBeNull()
    expect(sheet().textContent).toContain('Prefer FLAC')
  })

  /** A closed list offers every valid value and no way to invent another one. */
  it('edits a constrained list as choices and keeps its required final choice selected', async () => {
    const wrapper = await mountPanel({ adapters: [PLUGIN] })
    await openCreate(wrapper, 'demo-tracker')

    const group = sheet().querySelector('#indexer-setting-formats')!
    const choice = (value: string) => [...group.querySelectorAll('button')].find((button) => button.textContent?.trim() === value)!

    expect(group.querySelector('input')).toBeNull()
    expect(choice('epub').getAttribute('aria-pressed')).toBe('true')
    expect(choice('mobi').getAttribute('aria-pressed')).toBe('true')
    expect(choice('pdf').getAttribute('aria-pressed')).toBe('false')

    choice('epub').click()
    await flushPromises()

    expect(choice('mobi').disabled).toBe(true)
    expect(sheet().textContent).toContain('Restore defaults')

    const restoreButton = [...sheet().querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Restore defaults')!
    restoreButton.click()
    await flushPromises()

    expect(choice('epub').getAttribute('aria-pressed')).toBe('true')
    expect(choice('mobi').getAttribute('aria-pressed')).toBe('true')
    expect(sheet().textContent).not.toContain('Restore defaults')
  })

  it('repairs casing, duplicates, and unknown values from an older saved list', async () => {
    const wrapper = await mountPanel({
      adapters: [PLUGIN],
      indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker', settings: { formats: 'EPUB,epub,not-a-format' } })],
    })

    await clickInPanel(wrapper, 'Edit A tracker')

    const group = sheet().querySelector('#indexer-setting-formats')!
    const choice = (value: string) => [...group.querySelectorAll('button')].find((button) => button.textContent?.trim() === value)!
    expect(choice('epub').getAttribute('aria-pressed')).toBe('true')
    expect(choice('mobi').getAttribute('aria-pressed')).toBe('false')
    expect(group.textContent).not.toContain('not-a-format')
  })

  /** Older plugins can still declare an open-ended list when the valid values are not finite. */
  it('keeps free-entry chips for a list with no declared options', async () => {
    const plugin = descriptor({
      ...PLUGIN,
      settingsFields: [{ key: 'mirrors', type: 'string', format: 'list', label: 'Mirrors', default: 'one,two' }],
    })

    const wrapper = await mountPanel({ adapters: [plugin] })
    await openCreate(wrapper, 'demo-tracker')

    expect(sheet().querySelector<HTMLInputElement>('#indexer-setting-mirrors')).not.toBeNull()
  })

  it('prefills the base URL an adapter names for itself', async () => {
    const wrapper = await mountPanel({ adapters: [OPEN_LIBRARY] })
    await openCreate(wrapper, 'open-library')

    expect(sheet().querySelector<HTMLInputElement>('#indexer-url')?.value).toBe('https://openlibrary.example')
  })

  /**
   * The editor opens over the list rather than under it, so the row being edited is still there
   * when it closes.
   */
  it('keeps the list rendered while a row is being edited', async () => {
    const wrapper = await mountPanel({ indexers: [indexer()] })
    await clickInPanel(wrapper, 'Edit My Prowlarr')

    expect(wrapper.text()).toContain('My Prowlarr')
    expect(sheet().querySelector<HTMLInputElement>('#indexer-name')?.value).toBe('My Prowlarr')
  })

  /**
   * The colour is the operator's way of making a source recognisable in the release picker, where
   * the only other thing distinguishing two rows from different trackers is their names.
   */
  it('sends the colour picked for a source', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor()] })
    await openCreate(wrapper)
    typeInto('#indexer-name', 'MAM')
    typeInto('#indexer-url', 'http://localhost:9696')
    sheet().querySelector<HTMLInputElement>('input[name="indexer-color"][value="orange"]')!.click()
    await flushPromises()

    clickInSheet('Save')
    await flushPromises()

    const post = apiMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body)).color).toBe('orange')
  })

  it('preselects the only unused color when configuring a newly installed plugin', async () => {
    const existing = INDEXER_COLORS.filter((color) => color !== 'teal').map((color, offset) =>
      indexer({ id: offset + 1, name: `Source ${offset + 1}`, color }),
    )
    const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: existing })

    await openCreate(wrapper, 'demo-tracker')

    const checked = sheet().querySelector<HTMLInputElement>('input[name="indexer-color"]:checked')
    expect(checked?.value).toBe('teal')
    expect(sheet().querySelectorAll('input[name="indexer-color"]:not([value=""])')).toHaveLength(10)
  })

  it('opens the editor on the colour the source already has, and offers to take it away', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor()], indexers: [indexer({ color: 'purple' })] })
    await clickInPanel(wrapper, 'Edit My Prowlarr')

    const checked = sheet().querySelector<HTMLInputElement>('input[name="indexer-color"]:checked')
    expect(checked?.value).toBe('purple')
    expect(sheet().querySelector('input[name="indexer-color"][value=""]')).not.toBeNull()
  })

  /**
   * A rejection names the field it is about. Spending that on a toast that is gone in four seconds
   * leaves the operator looking at a form with no indication of which box is wrong.
   */
  it('shows a rejected save under the field it belongs to instead of as a toast', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor()] })
    await openCreate(wrapper)
    typeInto('#indexer-name', 'Taken')
    typeInto('#indexer-url', 'http://localhost:9696')
    await flushPromises()

    apiMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? response({ errorCode: 'INDEXER_NAME_TAKEN', message: 'taken' }, false)
          : response({ indexers: [], encryptionConfigured: true }),
      ),
    )
    clickInSheet('Save')
    await flushPromises()

    const error = sheet().querySelector('#indexer-name-error')
    expect(error?.textContent).toContain('already exists')
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  /** A required field that is simply empty is the form's own business, not a round trip. */
  it('refuses to send a save that is missing a name, and says which field', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor()] })
    await openCreate(wrapper)
    apiMock.mockClear()

    clickInSheet('Save')
    await flushPromises()

    expect(sheet().querySelector('#indexer-name-error')).not.toBeNull()
    expect(apiMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([])
  })

  /**
   * The loading flag swaps the whole section for a spinner. Refreshing the list through it after
   * a test tears the panel down and rebuilds it, which reads as the page reloading and loses the
   * reader's place, so a post-test refresh has to be silent.
   */
  it('does not blank the panel when testing a connection', async () => {
    const wrapper = await mountPanel({ indexers: [indexer()] })
    apiMock.mockClear()
    apiMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/test')
          ? response({ success: true, indexerName: 'Prowlarr' })
          : response({ indexers: [indexer()], encryptionConfigured: true }),
      ),
    )

    await clickInPanel(wrapper, 'Test connection')

    expect(wrapper.find('.settings-loading-state').exists()).toBe(false)
    expect(wrapper.text()).toContain('My Prowlarr')
  })

  /** Which adapters exist cannot change from testing a row, so asking again is a wasted call. */
  it('does not refetch the adapter list when testing a connection', async () => {
    const wrapper = await mountPanel({ indexers: [indexer()] })
    apiMock.mockClear()
    apiMock.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/test') ? response({ success: true }) : response({ indexers: [indexer()], encryptionConfigured: true })),
    )

    await clickInPanel(wrapper, 'Test connection')

    expect(apiMock.mock.calls.map((c) => c[0]).filter((u) => String(u).endsWith('/adapters'))).toEqual([])
  })

  /** A broken plugin must remain diagnosable and deletable instead of becoming a dead-end row. */
  it('says why a plugin failed to load and can delete it', async () => {
    const wrapper = await mountPanel({ pluginFailures: [{ directory: 'Broken Plugin', reason: 'it exports no search function' }] })

    expect(wrapper.text()).toContain('Broken Plugin')
    expect(wrapper.text()).toContain('it exports no search function')

    await clickInPanel(wrapper, 'Delete plugin')
    clickInConfirm('Delete plugin')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(`${PATH}/plugins/Broken%20Plugin`, expect.objectContaining({ method: 'DELETE' }))
  })

  /**
   * Silencing a source is reversible and routine; editing its credential is neither. Behind the
   * editor they were the same door, so the switch is on the row.
   */
  describe('turning a source off from its row', () => {
    function switchFor(wrapper: VueWrapper, name: string) {
      const found = wrapper.findAll('[role="switch"]').find((candidate) => candidate.attributes('aria-label')?.includes(name))
      if (found === undefined) throw new Error(`no switch for "${name}"`)
      return found
    }

    it('sends only the enabled flag, leaving the stored credential alone', async () => {
      const wrapper = await mountPanel({ indexers: [indexer()] })
      apiMock.mockClear()
      apiMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(init?.method === 'PUT' ? response({}) : response({ indexers: [indexer({ enabled: false })], encryptionConfigured: true })),
      )

      await switchFor(wrapper, 'My Prowlarr').trigger('click')
      await flushPromises()

      const [, init] = apiMock.mock.calls.find(([, options]) => (options as RequestInit | undefined)?.method === 'PUT') ?? []
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ enabled: false })
    })

    it('offers it for a plugin-backed source too', async () => {
      const wrapper = await mountPanel({
        adapters: [descriptor(), PLUGIN],
        indexers: [indexer({ id: 2, adapterType: 'demo-tracker', name: 'A tracker' })],
      })

      expect(switchFor(wrapper, 'A tracker').attributes('aria-checked')).toBe('true')
    })

    /** The badge beside the name is what says a source is off, so it has to follow the switch. */
    it('reads the state back off the row once the save lands', async () => {
      const wrapper = await mountPanel({ indexers: [indexer()] })
      apiMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(init?.method === 'PUT' ? response({}) : response({ indexers: [indexer({ enabled: false })], encryptionConfigured: true })),
      )

      await switchFor(wrapper, 'My Prowlarr').trigger('click')
      await flushPromises()

      expect(switchFor(wrapper, 'My Prowlarr').attributes('aria-checked')).toBe('false')
      expect(wrapper.text()).toContain('Disabled')
    })

    it('says so and leaves the switch where it was when the save is refused', async () => {
      const wrapper = await mountPanel({ indexers: [indexer()] })
      apiMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PUT'
            ? response({ message: 'Could not save that indexer' }, false)
            : response({ indexers: [indexer()], encryptionConfigured: true }),
        ),
      )

      await switchFor(wrapper, 'My Prowlarr').trigger('click')
      await flushPromises()

      expect(toastMock.error).toHaveBeenCalled()
      expect(switchFor(wrapper, 'My Prowlarr').attributes('aria-checked')).toBe('true')
    })
  })

  /**
   * An empty box means "keep", because that is what it looked like when the form opened. Sending
   * the empty string wiped a working credential and the next search failed with nothing saying why.
   */
  describe('stored credential', () => {
    async function editAndSave(wrapper: VueWrapper, act: () => void) {
      await clickInPanel(wrapper, 'Edit My Torznab')
      act()
      await flushPromises()
      clickInSheet('Save')
      await flushPromises()
      const saveCall = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
      return JSON.parse(String(saveCall?.[1]?.body)) as Record<string, unknown>
    }

    it('keeps it when a typed credential is erased again', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()], indexers: [indexer({ name: 'My Torznab' })] })

      const body = await editAndSave(wrapper, () => {
        typeInto('#indexer-credential', 'abcdef')
        typeInto('#indexer-credential', '')
      })

      expect(body).not.toHaveProperty('credential')
    })

    it('sends a typed credential', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()], indexers: [indexer({ name: 'My Torznab' })] })

      const body = await editAndSave(wrapper, () => typeInto('#indexer-credential', 'abcdef'))

      expect(body).toMatchObject({ credential: 'abcdef' })
    })

    it('removes it only when clearing is asked for outright', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()], indexers: [indexer({ name: 'My Torznab' })] })

      const body = await editAndSave(wrapper, () => clickInSheet('Clear'))

      expect(body).toMatchObject({ credential: '' })
    })

    it('offers no clearing on a source that has no stored credential', async () => {
      const wrapper = await mountPanel({ adapters: [descriptor()], indexers: [indexer({ name: 'My Torznab', hasCredential: false })] })
      await clickInPanel(wrapper, 'Edit My Torznab')

      expect([...sheet().querySelectorAll('button')].map(nameOf)).not.toContain('Clear')
    })

    it('offers no clearing when the adapter requires a credential', async () => {
      const wrapper = await mountPanel({ adapters: [PLUGIN], indexers: [indexer({ name: 'A tracker', adapterType: PLUGIN.type })] })
      await clickInPanel(wrapper, 'Edit A tracker')

      expect([...sheet().querySelectorAll('button')].map(nameOf)).not.toContain('Clear')
    })
  })

  /** Test runs against the saved row, so a green tick for a draft would be a tick for old values. */
  it('refuses to test while the draft differs from the saved source', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor()], indexers: [indexer({ name: 'My Torznab' })] })
    await clickInPanel(wrapper, 'Edit My Torznab')

    expect(sheet().querySelector<HTMLButtonElement>('button[aria-label="Test connection"]')?.disabled).toBe(false)

    typeInto('#indexer-url', 'http://127.0.0.1:9697/1')
    await flushPromises()

    expect(sheet().querySelector('button[aria-label="Test connection"]')).toBeNull()
    const dirtyTest = sheet().querySelector<HTMLButtonElement>('button[aria-label="Save your changes before testing"]')
    expect(dirtyTest?.getAttribute('aria-disabled')).toBe('true')
    dirtyTest?.click()
    await flushPromises()
    expect(apiMock.mock.calls.some(([url, init]) => String(url).endsWith('/test') && init?.method === 'POST')).toBe(false)
  })

  /**
   * Removing a plugin changes the adapter list, so the refresh has to ask for it again; what it
   * must not do is take the populated panel away and put a spinner where the reader was looking.
   */
  it('refreshes the adapters after a plugin removal without blanking the panel', async () => {
    const wrapper = await mountPanel({ adapters: [descriptor(), PLUGIN], indexers: [indexer({ adapterType: 'demo-tracker', name: 'A tracker' })] })

    let releaseList = () => {}
    const pending = new Promise<Response>((resolve) => {
      releaseList = () => resolve(response({ indexers: [], encryptionConfigured: true }))
    })
    apiMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve(response({}))
      if (url.endsWith('/adapters')) return Promise.resolve(response({ adapters: [descriptor()], pluginFailures: [] }))
      return pending
    })

    await clickInPanel(wrapper, 'Delete plugin')
    clickInConfirm('Delete plugin')
    await flushPromises()

    expect(wrapper.find('.settings-loading-state').exists()).toBe(false)
    expect(wrapper.text()).toContain('A tracker')

    releaseList()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(`${PATH}/adapters`)
  })

  /** An older removal may have left a source behind; it must still have a full cleanup path. */
  it('flags and can delete an orphaned plugin source', async () => {
    const wrapper = await mountPanel({
      indexers: [indexer({ adapterType: 'mam', name: 'An old tracker' })],
      adapters: [descriptor(), OPEN_LIBRARY],
    })

    expect(wrapper.text()).toContain('mam')
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    await clickInPanel(wrapper, 'Edit An old tracker')
    expect(sheet().textContent).toContain('plugin file is already gone')
    expect([...sheet().querySelectorAll('button')].map(nameOf)).toContain('Delete plugin')

    clickInSheet('Delete plugin')
    await flushPromises()
    clickInSheet('Delete plugin')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(`${PATH}/plugins/mam`, expect.objectContaining({ method: 'DELETE' }))
  })
})
