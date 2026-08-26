import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { Permission } from '@bookorbit/types'
import UserFormDrawer from '../UserFormDrawer.vue'

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

// The sheet portals its content out of the wrapper, which puts every assertion behind
// `document`. Stubbing it keeps the markup under test where Test Utils can see it.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: { template: '<div><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<h2><slot /></h2>' },
  SheetDescription: { template: '<p><slot /></p>' },
}))

const LIBRARIES = [
  { id: 1, name: 'Novels', bookCount: 120 },
  { id: 2, name: 'Comics', bookCount: 30 },
  { id: 3, name: 'Podcasts', bookCount: 0 },
]

const USER = {
  id: 7,
  username: 'ada',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  active: true,
  isSuperuser: false,
  provisioningMethod: 'local' as const,
  createdAt: '2026-03-14T10:00:00.000Z',
  permissions: [Permission.LibraryDownload, Permission.KoboSync] as string[],
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

function stubApi(overrides: { libraryIds?: number[]; filters?: unknown } = {}) {
  apiMock.mockImplementation(async (input: string) => {
    if (input.endsWith('/libraries')) return jsonResponse(overrides.libraryIds ?? [1])
    if (input.endsWith('/content-filters')) {
      return jsonResponse(overrides.filters ?? { includeTags: [], excludeTags: [], includeGenres: [], excludeGenres: [] })
    }
    return jsonResponse({})
  })
}

/** The drawer reads the viewport to decide between the section rail and the drill-in list. */
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

type Drawer = ReturnType<typeof mount>

async function mountDrawer(props: Record<string, unknown> = {}): Promise<Drawer> {
  const wrapper = mount(UserFormDrawer, {
    props: { user: USER, libraries: LIBRARIES, defaultLibraryIds: [], ...props },
  })
  await flushPromises()
  return wrapper
}

async function openSection(wrapper: Drawer, label: string) {
  const entry = wrapper.findAll('button').find((button) => button.text().includes(label))
  await entry?.trigger('click')
  await flushPromises()
}

function checkboxFor(wrapper: Drawer, label: string) {
  const field = wrapper.findAll('label').find((candidate) => candidate.text().includes(label))
  return field?.find<HTMLInputElement>('input[type="checkbox"]')
}

beforeEach(() => {
  vi.clearAllMocks()
  stubViewport(true)
  stubApi()
})

describe('UserFormDrawer sections', () => {
  it('summarises every section beside its nav entry', async () => {
    const wrapper = await mountDrawer()
    const nav = wrapper.find('nav').text()

    expect(nav).toContain('Profile')
    expect(nav).toContain('1 of 3')
    expect(nav).toContain('2 granted')
    expect(nav).toContain('None')
  })

  it('reports the account facts the list row only hints at', async () => {
    const wrapper = await mountDrawer()

    expect(wrapper.text()).toContain('Password')
    expect(wrapper.text()).toContain('2026')
    expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('true')
  })

  it('offers the drill-in list instead of the rail on a narrow viewport', async () => {
    stubViewport(false)
    const wrapper = await mountDrawer()

    expect(wrapper.find('nav').exists()).toBe(false)
    expect(wrapper.text()).toContain('Libraries')
    expect(wrapper.text()).not.toContain('Full name')

    await openSection(wrapper, 'Profile')
    expect(wrapper.text()).toContain('Full name')
  })

  it('reports how much of the library the selection reaches', async () => {
    const wrapper = await mountDrawer()
    await openSection(wrapper, 'Libraries')

    expect(wrapper.text()).toContain('120 books')
    expect(wrapper.text()).toContain('This account can see 120 of 150 books.')
  })

  it('warns when no library is selected at all', async () => {
    stubApi({ libraryIds: [] })
    const wrapper = await mountDrawer()
    await openSection(wrapper, 'Libraries')

    expect(wrapper.text()).toContain('No libraries selected')
  })
})

describe('UserFormDrawer permissions', () => {
  it('tags the elevated permissions rather than heading every group twice', async () => {
    const wrapper = await mountDrawer()
    await openSection(wrapper, 'Permissions')

    const deleteBooks = wrapper.findAll('label').find((label) => label.text().includes('Delete books'))
    expect(deleteBooks?.text()).toContain('Manage')
    expect(wrapper.text()).toContain('What this account is allowed to do. 2 of 26 granted.')
  })

  it('reports the preset the selection matches', async () => {
    const wrapper = await mountDrawer({
      user: { ...USER, permissions: [Permission.LibraryDownload, Permission.KoboSync, Permission.KoreaderSync] },
    })
    await openSection(wrapper, 'Permissions')

    const custom = wrapper.findAll('button').find((button) => button.text() === 'Custom')
    expect(custom?.attributes('aria-pressed')).toBe('true')
    expect(custom?.attributes('disabled')).toBeDefined()
  })

  it('keeps a demo restriction when a preset is applied', async () => {
    const wrapper = await mountDrawer({ user: { ...USER, permissions: [Permission.DemoRestricted] } })
    await openSection(wrapper, 'Permissions')

    const standard = wrapper.findAll('button').find((button) => button.text() === 'Standard')
    await standard?.trigger('click')
    await openSection(wrapper, 'Restrictions')

    expect(checkboxFor(wrapper, 'Demo restricted')?.element.checked).toBe(true)
  })

  /** The server resolves this dependency on assignment, so the boxes have to agree with it. */
  it('grants the permission that self-fulfilment depends on', async () => {
    const wrapper = await mountDrawer()
    await openSection(wrapper, 'Permissions')

    await checkboxFor(wrapper, 'Download books directly')?.trigger('change')

    expect(checkboxFor(wrapper, 'Request books')?.element.checked).toBe(true)
  })

  it('drops the dependent permission when its requirement is revoked', async () => {
    const wrapper = await mountDrawer({
      user: { ...USER, permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] },
    })
    await openSection(wrapper, 'Permissions')

    await checkboxFor(wrapper, 'Request books')?.trigger('change')

    expect(checkboxFor(wrapper, 'Download books directly')?.element.checked).toBe(false)
  })

  it('filters the grid down to matching permissions', async () => {
    const wrapper = await mountDrawer()
    await openSection(wrapper, 'Permissions')

    await wrapper.find('input[type="search"]').setValue('kobo')

    expect(wrapper.text()).toContain('Kobo sync')
    expect(wrapper.text()).not.toContain('Upload books')
  })

  it('says so when a filter matches nothing', async () => {
    const wrapper = await mountDrawer()
    await openSection(wrapper, 'Permissions')

    await wrapper.find('input[type="search"]').setValue('nothing matches this')

    expect(wrapper.text()).toContain('No permissions match that filter.')
  })
})

describe('UserFormDrawer saving', () => {
  it('counts the fields a cancel would throw away', async () => {
    const wrapper = await mountDrawer()
    await openSection(wrapper, 'Permissions')
    await checkboxFor(wrapper, 'Upload books')?.trigger('change')

    expect(wrapper.text()).toContain('1 unsaved change')

    await openSection(wrapper, 'Libraries')
    await checkboxFor(wrapper, 'Comics')?.trigger('change')

    expect(wrapper.text()).toContain('2 unsaved changes')
  })

  it('writes the profile, permissions, libraries and filters of an existing user', async () => {
    const wrapper = await mountDrawer()
    const save = wrapper.findAll('button').find((button) => button.text() === 'Save')
    await save?.trigger('click')
    await flushPromises()

    const calls = apiMock.mock.calls.map(([input, init]) => `${(init as RequestInit)?.method ?? 'GET'} ${input}`)
    expect(calls).toContain('PATCH /api/v1/users/7')
    expect(calls).toContain('PUT /api/v1/users/7/permissions')
    expect(calls).toContain('PUT /api/v1/users/7/libraries')
    expect(calls).toContain('PUT /api/v1/users/7/content-filters')
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('surfaces a failed step and moves to the section that owns it', async () => {
    apiMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/permissions') && init?.method === 'PUT') {
        return { ok: false, json: async () => ({ message: 'Permission denied' }) }
      }
      if (input.endsWith('/libraries')) return jsonResponse([1])
      if (input.endsWith('/content-filters')) return jsonResponse({})
      return jsonResponse({})
    })

    const wrapper = await mountDrawer()
    const save = wrapper.findAll('button').find((button) => button.text() === 'Save')
    await save?.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe('Permission denied')
    expect(wrapper.find('input[type="search"]').exists()).toBe(true)
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('blocks a create with no name and lands back on the field', async () => {
    const wrapper = await mountDrawer({ user: null })
    await openSection(wrapper, 'Permissions')

    const save = wrapper.findAll('button').find((button) => button.text() === 'Save')
    await save?.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe('Full name is required')
    expect(wrapper.text()).toContain('Full name')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('creates a password account and hands back its reset link', async () => {
    apiMock.mockImplementation(async (input: string) => {
      if (input === '/api/v1/users') return jsonResponse({ resetUrl: 'https://example.test/reset/abc' })
      return jsonResponse({})
    })

    const wrapper = await mountDrawer({ user: null })
    await wrapper.find('#user-form-name').setValue('Grace Hopper')
    await wrapper.find('#user-form-username').setValue('grace')
    await wrapper.find('#user-form-email').setValue('grace@example.com')

    const save = wrapper.findAll('button').find((button) => button.text() === 'Save')
    await save?.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')?.[0]).toEqual(['https://example.test/reset/abc'])
  })

  it('asks the page to delete rather than confirming inside the editor', async () => {
    const wrapper = await mountDrawer({ canDelete: true })
    const remove = wrapper.findAll('button').find((button) => button.text() === 'Delete')
    await remove?.trigger('click')

    expect(wrapper.emitted('delete')).toHaveLength(1)
  })
})
