import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import FileNamingSettings from '../FileNamingSettings.vue'

const { apiMock, toastSuccess, toastError, hasPermission } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  hasPermission: vi.fn<(permission: string) => boolean>(),
}))

const libraries = ref<Library[]>([])

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission }) }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))
// Menus render their items inline so a test can reach them without driving the popover.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div data-testid="menu"><slot /></div>' },
  DropdownMenuLabel: { template: '<div><slot /></div>' },
  DropdownMenuSeparator: { template: '<hr />' },
  DropdownMenuItem: {
    props: { disabled: { type: Boolean, default: false } },
    emits: ['select'],
    template: '<button type="button" role="menuitem" :disabled="disabled" @click="$emit(\'select\', $event)"><slot /></button>',
  },
}))
vi.mock('../file-naming/components/PatternExamplesSheet.vue', () => ({
  default: {
    props: { open: { type: Boolean, default: false } },
    template: '<div data-testid="pattern-examples-sheet" :data-open="String(open)" />',
  },
}))

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return { id: 7, name: 'Fiction', organizationMode: 'book_per_file', fileNamingPattern: null, fileRenameEnabled: false, ...overrides } as Library
}

const ok = (body: object): Response =>
  ({ ok: true, status: 200, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) }) as unknown as Response

async function mountPage() {
  const wrapper = mount(FileNamingSettings, {
    props: { embedded: true },
    global: { stubs: { RouterLink: { template: '<a data-testid="bulk-rename"><slot /></a>' } } },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>

const railButton = (wrapper: Wrapper, text: string) =>
  wrapper
    .find('nav')
    .findAll('button')
    .find((button) => button.text().includes(text))
const buttonWith = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find((button) => button.text().includes(text))
const patternField = (wrapper: Wrapper) => wrapper.find<HTMLTextAreaElement>('textarea#file-naming-pattern')

async function editPattern(wrapper: Wrapper, value: string) {
  const field = patternField(wrapper)
  field.element.value = value
  field.element.setSelectionRange(value.length, value.length)
  await field.trigger('input')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  i18n.global.locale.value = 'en'
  hasPermission.mockReturnValue(true)
  libraries.value = [makeLibrary()]
  apiMock.mockImplementation(() => Promise.resolve(ok({ pattern: '{authors}/{title}', enabled: true })))
})

describe('FileNamingSettings', () => {
  it('gives the pattern field a programmatic label and describes it with its scope and hint', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('label[for="file-naming-pattern"]').exists()).toBe(true)
    expect(patternField(wrapper).attributes('aria-describedby')).toBe('file-naming-pattern-scope file-naming-pattern-hint')
  })

  it('nests each library under the default for its organization mode', async () => {
    libraries.value = [makeLibrary(), makeLibrary({ id: 8, name: 'Comics', organizationMode: 'book_per_folder' })]
    const wrapper = await mountPage()

    const groups = wrapper.find('nav').findAll(':scope > ul > li')
    expect(groups.map((group) => group.find('button').text())).toEqual(['File as Book default', 'Folder as Book default', 'Download filename'])
    expect(groups[0]!.find('ul').text()).toContain('Fiction')
    expect(groups[1]!.find('ul').text()).toContain('Comics')
    expect(groups[2]!.find('ul').exists()).toBe(false)
  })

  it('opens on the File as Book default, one folder level per line', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('h2').text()).toContain('File as Book default')
    expect(patternField(wrapper).element.value).toBe('{authors}/\n{title}')
  })

  it('names the libraries a default governs and selects one from its link', async () => {
    libraries.value = [makeLibrary(), makeLibrary({ id: 9, name: 'PDFs' })]
    const wrapper = await mountPage()

    expect(wrapper.find('#file-naming-pattern-scope').text()).toBe('Used by Fiction and PDFs')
    await wrapper
      .find('#file-naming-pattern-scope')
      .findAll('button')
      .find((button) => button.text() === 'PDFs')
      ?.trigger('click')

    expect(wrapper.find('h2').text()).toContain('PDFs')
  })

  it('shows a library that has no pattern as following its default, with the field read-only', async () => {
    const wrapper = await mountPage()
    await railButton(wrapper, 'Fiction')?.trigger('click')

    expect(wrapper.find('#file-naming-pattern-scope').text()).toBe('Follows the File as Book default.')
    expect(wrapper.text()).toContain('This library follows the File as Book default')
    expect(patternField(wrapper).attributes('readonly')).toBeDefined()
  })

  it('makes the field editable once an override is added, and says what it overrides', async () => {
    const wrapper = await mountPage()
    await railButton(wrapper, 'Fiction')?.trigger('click')
    await buttonWith(wrapper, 'Add an override')?.trigger('click')

    expect(patternField(wrapper).attributes('readonly')).toBeUndefined()
    expect(wrapper.find('#file-naming-pattern-scope').text()).toBe('Overrides the File as Book default for this library only.')
    expect(buttonWith(wrapper, 'Use the global default')).toBeDefined()
  })

  it('shows the save bar only once something is unsaved', async () => {
    const wrapper = await mountPage()
    expect(buttonWith(wrapper, 'Save changes')).toBeUndefined()

    await editPattern(wrapper, '{title}')

    expect(wrapper.text()).toContain('1 unsaved change')
    expect(buttonWith(wrapper, 'Save changes')?.attributes('disabled')).toBeUndefined()
  })

  it('blocks saving and says why when the edited pattern is invalid', async () => {
    const wrapper = await mountPage()
    await editPattern(wrapper, '{title}?')

    expect(wrapper.find('#file-naming-pattern-error').text()).toBe('Pattern contains invalid characters')
    expect(patternField(wrapper).attributes('aria-invalid')).toBe('true')
    expect(buttonWith(wrapper, 'Save changes')?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Fix the invalid pattern before saving')
  })

  it('does not treat a token still being typed as an error', async () => {
    const wrapper = await mountPage()
    await editPattern(wrapper, '{authors}/{ti')

    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    expect(wrapper.find('#file-naming-pattern-error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Fix the invalid pattern before saving')
    expect(buttonWith(wrapper, 'Save changes')?.attributes('disabled')).toBeDefined()
  })

  it('restores the saved pattern and hides the save bar when the edit is discarded', async () => {
    const wrapper = await mountPage()
    await editPattern(wrapper, '{title}')
    await buttonWith(wrapper, 'Discard')?.trigger('click')

    expect(patternField(wrapper).element.value).toBe('{authors}/\n{title}')
    expect(buttonWith(wrapper, 'Save changes')).toBeUndefined()
  })

  it('previews the result and lists only what each missing field changes', async () => {
    const wrapper = await mountPage()
    const result = wrapper.find('[aria-label="Resolved result"]')

    expect(result.text()).toContain('William Gibson')
    expect(result.text()).toContain('Neuromancer.epub')
    expect(result.text()).toContain('If metadata is missing')
    // The mocked pattern has no fallback, so a book without an author gets a nameless folder.
    const author = result.findAll('button[aria-pressed]').find((row) => row.text().includes('No author'))
    expect(author?.text()).toContain('empty name')
    expect(
      result
        .findAll('button[aria-pressed]')
        .find((row) => row.text().includes('No year'))
        ?.text(),
    ).toContain('No change')
  })

  it('previews a missing-metadata case in the tree when its row is chosen', async () => {
    const wrapper = await mountPage()
    await editPattern(wrapper, '<{authors}|Unknown Author>/{title}')
    const row = () => wrapper.findAll('button[aria-pressed]').find((button) => button.text().includes('No author'))!

    await row().trigger('click')

    expect(row().attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('Previewing: No author')
    expect(wrapper.find('[aria-label="Resolved result"] ol').text()).toContain('Unknown Author')
  })

  it('previews with another book from the picker', async () => {
    const wrapper = await mountPage()
    await buttonWith(wrapper, 'Robinson Crusoe')?.trigger('click')

    expect(wrapper.find('[aria-label="Resolved result"] ol').text()).toContain('Daniel Defoe')
  })

  it('compares read-aloud and plain EPUB results when the pattern uses the readaloud token', async () => {
    const wrapper = await mountPage()
    await editPattern(wrapper, '{title}< ({readaloud})>')

    expect(wrapper.text()).toContain('Read-aloud comparison')
    expect(wrapper.text()).toContain('Plain EPUB')
    expect(wrapper.text()).toContain('Neuromancer (readaloud)')
  })

  it('inserts a token from the insert menu', async () => {
    const wrapper = await mountPage()
    const field = patternField(wrapper).element
    field.setSelectionRange(field.value.length, field.value.length)

    await wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.text().startsWith('{year}'))
      ?.trigger('click')
    await flushPromises()

    expect(patternField(wrapper).element.value).toBe('{authors}/\n{title}{year}')
  })

  it('applies a recipe to the pattern field', async () => {
    const wrapper = await mountPage()
    await buttonWith(wrapper, 'Calibre style')?.trigger('click')

    expect(patternField(wrapper).element.value).toContain('<{authors}|Unknown Author>/')
    expect(wrapper.text()).toContain('1 unsaved change')
  })

  it('opens the examples sheet from the recipes menu', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="pattern-examples-sheet"]').attributes('data-open')).toBe('false')

    await wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.text() === 'Examples')
      ?.trigger('click')

    expect(wrapper.find('[data-testid="pattern-examples-sheet"]').attributes('data-open')).toBe('true')
  })

  it('names the libraries that rename files to this pattern, and links to Bulk Rename for those allowed to run it', async () => {
    libraries.value = [makeLibrary({ fileRenameEnabled: true }), makeLibrary({ id: 9, name: 'PDFs' })]
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain("the next time a book's details are saved: Fiction.")
    expect(wrapper.find('[data-testid="bulk-rename"]').exists()).toBe(true)

    hasPermission.mockReturnValue(false)
    const restricted = await mountPage()
    expect(restricted.find('[data-testid="bulk-rename"]').exists()).toBe(false)
  })

  it('saves the cross-platform toggle immediately without a separate save button', async () => {
    const wrapper = await mountPage()

    await wrapper.find('button[role="switch"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/app-settings/cross-platform-path-sanitization',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: false }) }),
    )
  })

  it('still lists the global defaults when no libraries are configured', async () => {
    libraries.value = []
    const wrapper = await mountPage()

    expect(railButton(wrapper, 'File as Book default')).toBeDefined()
    expect(wrapper.text()).toContain('No library uses this default right now')
  })
})
