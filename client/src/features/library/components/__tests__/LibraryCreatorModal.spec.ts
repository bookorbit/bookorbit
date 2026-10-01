import { flushPromises, mount, shallowMount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { useLibraryCreator } from '../../composables/useLibraryCreator'
import LibraryCreatorDetails from '../LibraryCreatorDetails.vue'
import LibraryCreatorFolders from '../LibraryCreatorFolders.vue'
import LibraryCreatorModal from '../LibraryCreatorModal.vue'
import LibraryCreatorScanner from '../LibraryCreatorScanner.vue'
import LibraryCreatorSchedule from '../LibraryCreatorSchedule.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

/** The editor reads the viewport to decide between the section rail and the drill-in list. */
function stubViewport(wide: boolean) {
  window.matchMedia = vi.fn<(query: string) => unknown>().mockImplementation((query: string) => ({
    matches: query.includes('min-width') ? wide : !wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn<() => void>(),
    removeEventListener: vi.fn<() => void>(),
    addListener: vi.fn<() => void>(),
    removeListener: vi.fn<() => void>(),
    dispatchEvent: vi.fn<() => void>(),
  })) as unknown as typeof window.matchMedia
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    ...useLibraryCreator().form,
    id: 9,
    name: 'Fantasy',
    icon: 'Swords',
    folders: [{ id: 1, path: '/books', role: 'downloads', createdAt: '2026-01-01T00:00:00.000Z' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Library
}

function navButton(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('nav button').find((candidate) => candidate.text().startsWith(label))
  if (!button) throw new Error(`No section named ${label}`)
  return button
}

function footerButton(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('footer button').find((candidate) => candidate.text().includes(label))
  if (!button) throw new Error(`No footer button named ${label}`)
  return button
}

async function mountCreator(props: Record<string, unknown> = {}, stubs: Record<string, unknown> = {}) {
  const wrapper = shallowMount(LibraryCreatorModal, { props, attachTo: document.body, global: { stubs: { teleport: true, ...stubs } } })
  await flushPromises()
  return wrapper
}

describe('LibraryCreatorModal', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    stubViewport(true)
    apiMock.mockImplementation(async () => jsonResponse(null))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    apiMock.mockReset()
    vi.restoreAllMocks()
  })

  it('renders an accessible sheet that names what a new library still needs', async () => {
    const wrapper = await mountCreator()

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('library-creator-title')
    expect(wrapper.get('#library-creator-title').text()).toBe('New library')
    expect(wrapper.get('button[aria-label="Close library creator"]')).toBeTruthy()
    expect(navButton(wrapper, 'Library').text()).toContain('Needs a name')
    expect(navButton(wrapper, 'Folders').text()).toContain('Needs a folder')
    expect(footerButton(wrapper, 'Create library').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('offers every section while creating, with no step order to follow', async () => {
    const wrapper = await mountCreator()

    await navButton(wrapper, 'Metadata').trigger('click')

    expect(wrapper.find('main').text()).toContain('Which file leads when a book has several')
    wrapper.unmount()
  })

  it('checks a folder as soon as it is added and enables create once the essentials are in', async () => {
    apiMock.mockImplementation(async (url) =>
      String(url).endsWith('/prescan')
        ? jsonResponse({ paths: [{ path: '/books', accessible: true, fileCount: 1284 }], totalFiles: 1284 })
        : jsonResponse(null),
    )
    const wrapper = await mountCreator()

    const details = wrapper.getComponent(LibraryCreatorDetails)
    details.vm.$emit('update:name', 'Fantasy')
    details.vm.$emit('update:icon', 'Swords')
    await navButton(wrapper, 'Folders').trigger('click')
    wrapper.getComponent(LibraryCreatorFolders).vm.$emit('update:folders', ['/books'])
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/libraries/prescan', expect.objectContaining({ body: JSON.stringify({ paths: ['/books'] }) }))
    expect(navButton(wrapper, 'Folders').text()).toContain('1 folder · 1,284 files')
    expect(footerButton(wrapper, 'Create library').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('asks in the footer before discarding changes, instead of a browser dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const wrapper = await mountCreator()

    wrapper.getComponent(LibraryCreatorDetails).vm.$emit('update:name', 'Draft')
    await wrapper.vm.$nextTick()
    await footerButton(wrapper, 'Cancel').trigger('click')

    expect(wrapper.get('footer').text()).toContain('Discard your unsaved changes?')
    expect(wrapper.emitted('close')).toBeUndefined()
    await footerButton(wrapper, 'Discard').trigger('click')

    expect(wrapper.emitted('close')).toEqual([[]])
    expect(confirmSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('uses fetched saved settings for delegated managers whose library list omits the source', async () => {
    const full = { ...makeLibrary({ id: 7, name: 'Library' }), addedAtSource: 'file_created' }
    apiMock.mockImplementation(async (url) => jsonResponse(String(url).endsWith('/libraries/7') ? full : null))
    const listEntry = { id: 7, name: 'Library', folders: [], coverAspectRatio: '2/3' } as unknown as Library

    const wrapper = await mountCreator({ library: listEntry })
    await navButton(wrapper, 'Scanning').trigger('click')

    const scanner = wrapper.getComponent(LibraryCreatorScanner)
    expect(scanner.props('addedAtSource')).toBe('file_created')
    expect(scanner.props('storedAddedAtSource')).toBe('file_created')
    expect(scanner.props('organizationModeLocked')).toBe(true)
    wrapper.unmount()
  })

  it('opens on the section it was asked for', async () => {
    const library = makeLibrary()
    apiMock.mockImplementation(async (url) => jsonResponse(String(url).endsWith('/libraries/9') ? library : null))
    const wrapper = await mountCreator({ library, initialSection: 'access' })

    expect(navButton(wrapper, 'Access').attributes('aria-current')).toBe('true')
    wrapper.unmount()
  })

  it("starts a new library from another one's settings, without its folders", async () => {
    const template = makeLibrary({ name: 'Novels', watch: true, autoScanCronExpression: '0 0 * * 1', fileRenameEnabled: true })
    const wrapper = await mountCreator({ template })

    expect(wrapper.get('#library-creator-title').text()).toBe('New library')
    expect(wrapper.getComponent(LibraryCreatorDetails).props('name')).toBe('Novels copy')
    expect(wrapper.getComponent(LibraryCreatorDetails).props('icon')).toBe('Swords')
    expect(navButton(wrapper, 'Folders').text()).toContain('Needs a folder')
    expect(navButton(wrapper, 'Automation').text()).toContain('Watching · Weekly')
    expect(navButton(wrapper, 'File updates').text()).toContain('Renames')
    expect(apiMock.mock.calls.some((call) => String(call[0]).endsWith('/libraries/9'))).toBe(false)
    wrapper.unmount()
  })

  it('keeps save disabled until something changes while editing', async () => {
    const library = makeLibrary()
    apiMock.mockImplementation(async (url) => jsonResponse(String(url).endsWith('/libraries/9') ? library : null))
    const wrapper = await mountCreator({ library })

    expect(footerButton(wrapper, 'Save changes').attributes('disabled')).toBeDefined()
    wrapper.getComponent(LibraryCreatorDetails).vm.$emit('update:name', 'Epic Fantasy')
    await wrapper.vm.$nextTick()

    expect(footerButton(wrapper, 'Save changes').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Unsaved')
    wrapper.unmount()
  })

  it('clamps attempted podcast creation to a book library', async () => {
    const wrapper = await mountCreator()

    const details = wrapper.getComponent(LibraryCreatorDetails)
    details.vm.$emit('update:type', 'podcasts')
    await wrapper.vm.$nextTick()

    expect(details.props('type')).toBe('books')
    wrapper.unmount()
  })

  it('shows sections as a drill-in list on narrow screens', async () => {
    stubViewport(false)
    const wrapper = await mountCreator()

    expect(wrapper.find('nav').exists()).toBe(false)
    const entry = wrapper.findAll('main button').find((button) => button.text().startsWith('Reading'))!
    await entry.trigger('click')

    expect(wrapper.get('#library-creator-title').text()).toBe('Reading')
    expect(wrapper.find('button[aria-label="Back"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('grants queued access after creating, and stays open on Access when a grant fails', async () => {
    const created = makeLibrary()
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      const method = init?.method ?? 'GET'
      if (path.endsWith('/users/assignable')) {
        return jsonResponse([
          { id: 2, username: 'maya', name: 'Maya Ortiz' },
          { id: 3, username: 'sam', name: 'Sam Whitfield' },
        ])
      }
      if (path.endsWith('/prescan')) return jsonResponse({ paths: [{ path: '/books', accessible: true, fileCount: 3 }], totalFiles: 3 })
      if (path === '/api/v1/libraries' && method === 'POST') return jsonResponse(created)
      if (path === '/api/v1/libraries/9/access' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { userId: number }
        return body.userId === 2 ? jsonResponse({}) : jsonResponse({ message: 'nope' }, 500)
      }
      if (path === '/api/v1/libraries/9/access') return jsonResponse([{ userId: 2, username: 'maya', name: 'Maya Ortiz', accessLevel: 'viewer' }])
      return jsonResponse(null)
    })
    const wrapper = await mountCreator({}, { LibraryCreatorAccess: false, LibraryCreatorCard: false })

    const details = wrapper.getComponent(LibraryCreatorDetails)
    details.vm.$emit('update:name', 'Fantasy')
    details.vm.$emit('update:icon', 'Swords')
    await navButton(wrapper, 'Folders').trigger('click')
    wrapper.getComponent(LibraryCreatorFolders).vm.$emit('update:folders', ['/books'])
    await navButton(wrapper, 'Access').trigger('click')
    await flushPromises()

    for (const userId of ['2', '3']) {
      await wrapper.get('#library-access-user').setValue(userId)
      await wrapper.get('main form').trigger('submit')
    }
    expect(navButton(wrapper, 'Access').text()).toContain('2 people to add')

    await footerButton(wrapper, 'Create library').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('1 person could not be added')
    expect(wrapper.get('[role="alert"]').text()).toContain('Sam Whitfield')
    expect(wrapper.get('#library-creator-title').text()).toBe('Fantasy')

    await footerButton(wrapper, 'Done').trigger('click')
    expect(wrapper.emitted('saved')).toEqual([[created]])
    wrapper.unmount()
  })

  it('renders only folder watching when scan scheduling is unavailable', () => {
    const wrapper = mount(LibraryCreatorSchedule, {
      props: { watch: true, autoScanCronExpression: null, showAutoScanSchedule: false },
    })

    expect(wrapper.text()).toContain('Watch folders')
    expect(wrapper.text()).not.toContain('Auto-scan schedule')
  })
})
