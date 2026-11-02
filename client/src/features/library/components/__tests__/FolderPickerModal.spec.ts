import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FolderPickerModal from '../FolderPickerModal.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

const entry = (path: string, extra: Record<string, unknown> = {}) => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  mount: false,
  system: false,
  appData: false,
  hasChildren: false,
  ...extra,
})
const LISTINGS: Record<string, unknown[]> = {
  '/': [entry('/books', { mount: true, hasChildren: true }), entry('/data', { appData: true }), entry('/usr', { system: true, hasChildren: true })],
  '/books': [entry('/books/Fiction', { hasChildren: true }), entry('/books/Science Fiction'), entry('/books/Unsorted')],
}
const FILES: Record<string, number> = { '/books': 300, '/books/Fiction': 139, '/books/Science Fiction': 45, '/books/Unsorted': 12, '/data': 0 }

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function summary(path: string) {
  const files = FILES[path] ?? 0
  return {
    path,
    state: 'ok',
    files,
    folderBooks: files,
    formats: files ? { epub: files } : {},
    folders: 0,
    mergedFolders: path === '/books/Unsorted' ? 2 : 0,
    splitAudioFolders: 0,
    truncated: false,
  }
}

function server(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://localhost')
  const path = url.searchParams.get('path') ?? ''
  if (url.pathname === '/api/v1/path/places')
    return json({
      root: '/',
      mounts: ['/books'],
      appDataPath: '/data',
      libraries: [{ id: 7, name: 'Novels', icon: 'BookOpen', folders: ['/books/Fiction'] }],
    })
  if (url.pathname === '/api/v1/path/listing')
    return json({ path, state: path === '/proc' ? 'blocked' : 'ok', entries: LISTINGS[path] ?? [], truncated: false })
  if (url.pathname === '/api/v1/path/search') return json({ results: ['/books/Fiction', '/books/Unsorted'], truncated: false })
  if (url.pathname === '/api/v1/path/summaries') return json((JSON.parse(String(init?.body)).paths as string[]).map(summary))
  if (url.pathname === '/api/v1/path/inspect') return json({ ...summary(path), bytes: 2048, samples: ['Ann Leckie/Ancillary Justice.epub'] })
  if (url.pathname === '/api/v1/path/unclaimed')
    return json({ folders: [{ path: '/books/Science Fiction', files: 45, formats: { epub: 45 } }], truncated: false })
  if (url.pathname === '/api/v1/path' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    return json({ name: body.name, path: `${body.parentPath}/${body.name}` })
  }
  return json({}, 404)
}

const stubs = {
  Teleport: true,
  RecycleScroller: {
    props: ['items'],
    template: '<div role="tree"><template v-for="item in items" :key="item.key"><slot :item="item" /></template><slot name="after" /></div>',
  },
}

function useViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop && query.includes('min-width: 640px'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })),
  )
}

function pressEscape(target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(FolderPickerModal, { props: { libraryName: 'Science Fiction', ...props }, global: { stubs }, attachTo: document.body })
}

const row = (wrapper: ReturnType<typeof mountPicker>, path: string) => wrapper.find(`[role="treeitem"][data-path="${path}"]`)
const button = (wrapper: ReturnType<typeof mountPicker>, text: string) => {
  const found = wrapper.findAll('button').find((candidate) => candidate.text().trim() === text)
  if (!found) throw new Error(`Button not found: ${text}`)
  return found
}

async function settle(ms = 60) {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, ms))
  await flushPromises()
}

describe('FolderPickerModal', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(server)
    localStorage.clear()
    useViewport(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('opens on the first mount, with library landmarks, the data folder marked and system folders hidden', async () => {
    const wrapper = mountPicker()
    await settle()

    expect(wrapper.find('h2').text()).toBe('Choose folders')
    expect(wrapper.text()).toContain('For Science Fiction · Folder as Book')
    expect(row(wrapper, '/books').attributes('aria-expanded')).toBe('true')
    expect(row(wrapper, '/books/Fiction').text()).toContain('Novels')
    expect(row(wrapper, '/data').text()).toContain('BookOrbit data')
    expect(row(wrapper, '/usr').exists()).toBe(false)
    expect(wrapper.text()).toContain('1 system folder hidden at /')
    expect(wrapper.text()).toContain('Not in any library yet')
  })

  it('adds the ticked folders and remembers where they were', async () => {
    const wrapper = mountPicker()
    await settle()
    expect(button(wrapper, 'Add folders').attributes('disabled')).toBeDefined()

    await row(wrapper, '/books/Science Fiction').find('input').trigger('click')
    await settle()
    await button(wrapper, 'Add 1 folder').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[['/books/Science Fiction']]])
    expect(JSON.parse(localStorage.getItem('bookorbit:folder-picker:recent') ?? '[]')).toEqual(['/books'])
  })

  it('warns about an overlap on a ticked folder and offers to leave the other library’s folder out', async () => {
    const wrapper = mountPicker()
    await settle()

    await row(wrapper, '/books').find('input').trigger('click')
    await settle()

    expect(wrapper.text()).toContain('Contains Fiction, which Novels reads.')
    await button(wrapper, 'Leave out Fiction').trigger('click')
    await settle()
    await button(wrapper, 'Add 2 folders').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[['/books/Science Fiction', '/books/Unsorted']]])
  })

  it('shows the books each mode would import and switches the library’s mode', async () => {
    const wrapper = mountPicker()
    await settle()
    await row(wrapper, '/books/Unsorted').find('input').trigger('click')
    await settle()

    expect(wrapper.text()).toContain('2 folders here hold several books')
    await button(wrapper, 'Use File as Book').trigger('click')

    expect(wrapper.emitted('update:organizationMode')).toEqual([['book_per_file']])
    expect(wrapper.text()).toContain('Switched to File as Book')
    await button(wrapper, 'Undo').trigger('click')
    expect(wrapper.emitted('update:organizationMode')).toEqual([['book_per_file'], ['book_per_folder']])
  })

  it('puts the organization back when the picker is cancelled after switching it', async () => {
    const wrapper = mountPicker()
    await settle()
    await row(wrapper, '/books/Unsorted').find('input').trigger('click')
    await settle()
    await button(wrapper, 'Use File as Book').trigger('click')

    await button(wrapper, 'Cancel').trigger('click')

    expect(wrapper.emitted('update:organizationMode')).toEqual([['book_per_file'], ['book_per_folder']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes the View menu with Escape, not the picker', async () => {
    const wrapper = mountPicker()
    await settle()
    await wrapper.find('[aria-label="View options"]').trigger('click')
    await settle()
    expect(wrapper.find('[aria-label="View options"]').attributes('aria-expanded')).toBe('true')

    pressEscape()
    await settle()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('on a phone, closes the plan sheet with Escape, not the picker', async () => {
    useViewport(false)
    const wrapper = mountPicker()
    await settle()
    await wrapper
      .findAll('button[aria-expanded]')
      .find((candidate) => candidate.text().includes('See the plan'))!
      .trigger('click')
    expect(wrapper.find('[role="dialog"] [role="dialog"]').exists()).toBe(true)

    pressEscape(wrapper.find('[role="dialog"] [role="dialog"]').element)
    await settle()

    expect(wrapper.find('[role="dialog"] [role="dialog"]').exists()).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('ticks a Shift range only across the folders a find shows', async () => {
    const wrapper = mountPicker()
    await settle()
    await wrapper.find('#folder-picker-field').setValue('o')
    await new Promise((resolve) => setTimeout(resolve, 260))
    await settle()

    await row(wrapper, '/books/Fiction').find('input').trigger('click')
    await row(wrapper, '/books/Unsorted').find('input').trigger('click', { shiftKey: true })
    await settle()

    expect(row(wrapper, '/books/Science Fiction').exists()).toBe(false)
    await button(wrapper, 'Add 2 folders').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[['/books/Fiction', '/books/Unsorted']]])
  })

  it('leaves Enter on the hidden-system-folders button to that button, not the focused folder', async () => {
    const wrapper = mountPicker()
    await settle()
    await row(wrapper, '/books/Unsorted').find('[data-row-focus]').trigger('click')

    await button(wrapper, '1 system folder hidden at /').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(button(wrapper, 'Add folders').attributes('disabled')).toBeDefined()
  })

  it('makes the first folder reachable with Tab before any is focused', async () => {
    const wrapper = mountPicker()
    await settle()

    const stops = wrapper.findAll('[role="treeitem"] [data-row-focus]').filter((focus) => focus.attributes('tabindex') === '0')
    expect(stops.map((focus) => focus.element.closest('[role="treeitem"]')!.getAttribute('data-path'))).toEqual(['/books'])
  })

  it('shows the mode as fixed when editing a library', async () => {
    const wrapper = mountPicker({ organizationModeLocked: true, libraryName: 'Novels', selectedPaths: ['/books/Fiction'], libraryId: 7 })
    await settle()
    await row(wrapper, '/books/Unsorted').find('input').trigger('click')
    await settle()

    expect(wrapper.text()).toContain('Folder as Book, fixed since Novels was created')
    expect(wrapper.text()).toContain('Organization is fixed once a library exists.')
    expect(wrapper.findAll('button').some((candidate) => candidate.text().includes('Use File as Book'))).toBe(false)
    expect(row(wrapper, '/books/Fiction').text()).toContain('This library')
  })

  it('previews a focused folder before it is ticked', async () => {
    const wrapper = mountPicker()
    await settle()

    await row(wrapper, '/books/Science Fiction').find('[data-row-focus]').trigger('click')
    await settle(200)

    expect(wrapper.text()).toContain('Looking at')
    expect(wrapper.text()).toContain('Would add 45 books')
    expect(wrapper.text()).toContain('Ann Leckie/Ancillary Justice.epub')
  })

  it('completes a typed path with Tab and closes the list with Escape without closing the dialog', async () => {
    const wrapper = mountPicker()
    await settle()
    const field = wrapper.find('#folder-picker-field')

    await field.setValue('/books/Sc')
    await settle()
    await field.trigger('keydown', { key: 'Tab' })
    await settle()
    expect((field.element as HTMLInputElement).value).toBe('/books/Science Fiction/')

    await field.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('says a typed system path is never opened instead of jumping to it', async () => {
    const wrapper = mountPicker()
    await settle()
    const field = wrapper.find('#folder-picker-field')

    await field.setValue('/proc')
    await field.trigger('keydown', { key: 'Enter' })
    await settle()

    expect(wrapper.text()).toContain('BookOrbit never opens /proc: it is a system folder.')
    expect(field.attributes('aria-activedescendant')).toBeUndefined()
  })

  it('makes a new folder inside the focused one and ticks it', async () => {
    const wrapper = mountPicker()
    await settle()
    await row(wrapper, '/books/Fiction').find('[data-row-focus]').trigger('click')
    await settle()

    await button(wrapper, 'New folder').trigger('click')
    await settle()
    const input = wrapper.find('#folder-picker-new-folder')
    await input.setValue('Fantasy')
    await input.trigger('keydown', { key: 'Enter' })
    await settle()

    const create = apiMock.mock.calls.find(([url, init]) => String(url) === '/api/v1/path' && init?.method === 'POST')
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({ parentPath: '/books/Fiction', name: 'Fantasy' })
    expect(wrapper.text()).toContain('Made /books/Fiction/Fantasy and ticked it.')
    expect(button(wrapper, 'Add 1 folder').exists()).toBe(true)
  })

  it('says a new folder inside this library’s folder was made, without claiming it was ticked', async () => {
    const wrapper = mountPicker({ selectedPaths: ['/books/Fiction'], libraryId: 7, libraryName: 'Novels' })
    await settle()
    await row(wrapper, '/books/Fiction').find('[data-row-focus]').trigger('click')
    await settle()

    await button(wrapper, 'New folder').trigger('click')
    await settle()
    const input = wrapper.find('#folder-picker-new-folder')
    await input.setValue('Fantasy')
    await input.trigger('keydown', { key: 'Enter' })
    await settle()

    expect(wrapper.text()).toContain('Made /books/Fiction/Fantasy.')
    expect(wrapper.text()).not.toContain('and ticked it')
  })

  it('refuses a folder name with a slash before asking the server', async () => {
    const wrapper = mountPicker()
    await settle()
    await button(wrapper, 'New folder').trigger('click')
    await settle()
    const input = wrapper.find('#folder-picker-new-folder')
    await input.setValue('a/b')
    await input.trigger('keydown', { key: 'Enter' })
    await settle()

    expect(wrapper.text()).toContain('Use one folder name, without slashes or a leading dot.')
    expect(apiMock.mock.calls.some(([url, init]) => String(url) === '/api/v1/path' && init?.method === 'POST')).toBe(false)
  })
})
