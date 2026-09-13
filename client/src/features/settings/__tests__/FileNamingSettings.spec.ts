import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import FileNamingSettings from '../FileNamingSettings.vue'

const { apiMock, toastSuccess, toastError } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

const libraries = ref<Library[]>([])

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))
vi.mock('../file-naming/components/PatternExamplesSheet.vue', () => ({
  default: {
    props: { open: { type: Boolean, default: false } },
    template: '<div data-testid="pattern-examples-sheet" :data-open="String(open)" />',
  },
}))

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return { id: 7, name: 'Fiction', organizationMode: 'book_per_file', fileNamingPattern: null, ...overrides } as Library
}

const ok = (body: object): Response =>
  ({ ok: true, status: 200, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) }) as unknown as Response

async function mountPage() {
  const wrapper = mount(FileNamingSettings, { props: { embedded: true } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>

const buttonWith = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find((button) => button.text().includes(text))
const patternField = (wrapper: Wrapper) => wrapper.find<HTMLTextAreaElement>('textarea#file-naming-pattern')

beforeEach(() => {
  vi.clearAllMocks()
  i18n.global.locale.value = 'en'
  libraries.value = [makeLibrary()]
  apiMock.mockImplementation(() => Promise.resolve(ok({ pattern: '{authors}/{title}', enabled: true })))
})

describe('FileNamingSettings', () => {
  it('gives the pattern field a programmatic label and describes it with its hint', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('label[for="file-naming-pattern"]').exists()).toBe(true)
    expect(patternField(wrapper).attributes('aria-describedby')).toContain('file-naming-pattern-hint')
  })

  it('lists every global default and every library as a selectable rule', async () => {
    libraries.value = [makeLibrary(), makeLibrary({ id: 8, name: 'Comics', organizationMode: 'book_per_folder' })]
    const wrapper = await mountPage()

    for (const name of ['File as Book default', 'Folder as Book default', 'Download filename', 'Fiction', 'Comics']) {
      expect(buttonWith(wrapper, name)).toBeDefined()
    }
  })

  it('opens on the File as Book default', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('h2').text()).toContain('File as Book default')
    expect(patternField(wrapper).element.value).toBe('{authors}/{title}')
  })

  it('renders the pattern as coloured pieces rather than one undifferentiated string', async () => {
    const wrapper = await mountPage()
    const layer = wrapper.find('pre[aria-hidden="true"]')

    expect(layer.findAll('span.text-pattern-token').length).toBeGreaterThan(0)
    expect(layer.text()).toBe('{authors}/{title}')
  })

  it('shows a library that has no pattern as inheriting, with the field read-only', async () => {
    const wrapper = await mountPage()
    await buttonWith(wrapper, 'Fiction')?.trigger('click')

    expect(wrapper.text()).toContain('This library follows the File as Book default')
    expect(patternField(wrapper).attributes('readonly')).toBeDefined()
    expect(buttonWith(wrapper, 'Add an override')).toBeDefined()
  })

  it('makes the field editable once an override is added', async () => {
    const wrapper = await mountPage()
    await buttonWith(wrapper, 'Fiction')?.trigger('click')
    await buttonWith(wrapper, 'Add an override')?.trigger('click')

    expect(patternField(wrapper).attributes('readonly')).toBeUndefined()
    expect(wrapper.text()).toContain('Use the global default')
  })

  it('counts unsaved rules in the save bar and enables saving', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('No unsaved changes')
    expect(buttonWith(wrapper, 'Save changes')?.attributes('disabled')).toBeDefined()

    await patternField(wrapper).setValue('{title}')

    expect(wrapper.text()).toContain('1 unsaved change')
    expect(buttonWith(wrapper, 'Save changes')?.attributes('disabled')).toBeUndefined()
  })

  it('blocks saving and says why when the edited pattern is invalid', async () => {
    const wrapper = await mountPage()
    await patternField(wrapper).setValue('{title}?')

    const error = wrapper.find('#file-naming-pattern-error')
    expect(error.text()).toBe('Pattern contains invalid characters')
    expect(patternField(wrapper).attributes('aria-invalid')).toBe('true')
    expect(buttonWith(wrapper, 'Save changes')?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Fix the invalid pattern before saving')
  })

  it('restores the saved pattern when the edit is discarded', async () => {
    const wrapper = await mountPage()
    await patternField(wrapper).setValue('{title}')
    await buttonWith(wrapper, 'Discard')?.trigger('click')

    expect(patternField(wrapper).element.value).toBe('{authors}/{title}')
    expect(wrapper.text()).toContain('No unsaved changes')
  })

  it('previews the resolved path and what happens when metadata is missing', async () => {
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('Neuromancer')
    expect(wrapper.text()).toContain('If metadata is missing')
    for (const label of ['No series', 'No year', 'No author']) {
      expect(wrapper.text()).toContain(label)
    }
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

  it('filters the rule list down to a matching name', async () => {
    libraries.value = [makeLibrary(), makeLibrary({ id: 8, name: 'Comics' })]
    const wrapper = await mountPage()

    await wrapper.find('input#file-naming-rule-filter').setValue('comics')

    expect(buttonWith(wrapper, 'Comics')).toBeDefined()
    expect(buttonWith(wrapper, 'Fiction')).toBeUndefined()
  })

  it('opens the examples sheet from its trigger', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="pattern-examples-sheet"]').attributes('data-open')).toBe('false')

    await buttonWith(wrapper, 'Examples')?.trigger('click')

    expect(wrapper.find('[data-testid="pattern-examples-sheet"]').attributes('data-open')).toBe('true')
  })

  it('applies a recipe to the pattern field', async () => {
    const wrapper = await mountPage()
    await buttonWith(wrapper, 'Calibre style')?.trigger('click')

    expect(patternField(wrapper).element.value).toContain('{authors}')
    expect(wrapper.text()).toContain('1 unsaved change')
  })

  it('still lists the global defaults when no libraries are configured', async () => {
    libraries.value = []
    const wrapper = await mountPage()

    expect(buttonWith(wrapper, 'File as Book default')).toBeDefined()
    expect(wrapper.text()).toContain('No libraries use this default')
  })
})
