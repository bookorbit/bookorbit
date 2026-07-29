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
vi.mock('../PatternHelpSheet.vue', () => ({
  default: {
    props: { open: { type: Boolean, default: false } },
    template: '<div data-testid="pattern-help-sheet" :data-open="String(open)" />',
  },
}))

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 7,
    name: 'Fiction',
    organizationMode: 'book_per_file',
    fileNamingPattern: null,
    ...overrides,
  } as Library
}

function respondWith(pattern: string): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue({ pattern, enabled: true }),
  } as unknown as Response
}

async function mountPage() {
  const wrapper = mount(FileNamingSettings, { props: { embedded: true } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  i18n.global.locale.value = 'en'
  libraries.value = [makeLibrary()]
  apiMock.mockImplementation(() => Promise.resolve(respondWith('{authors}/{title}')))
})

describe('FileNamingSettings', () => {
  it('gives every pattern input a programmatic label', async () => {
    const wrapper = await mountPage()

    for (const fieldId of ['file-naming-file-as-book', 'file-naming-folder-as-book', 'file-naming-download']) {
      expect(wrapper.find(`input#${fieldId}`).exists()).toBe(true)
      expect(wrapper.find(`label[for="${fieldId}"]`).exists()).toBe(true)
    }
  })

  it('labels each library override input with the library name', async () => {
    const wrapper = await mountPage()

    const label = wrapper.find('label[for="file-naming-library-7"]')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('Fiction')
    expect(wrapper.find('input#file-naming-library-7').exists()).toBe(true)
  })

  it('disables a pattern save button until the field is edited', async () => {
    const wrapper = await mountPage()

    const field = wrapper.find('input#file-naming-file-as-book')
    const saveButton = () => wrapper.findAll('button.settings-btn-primary')[0]

    expect(saveButton()?.attributes('disabled')).toBeDefined()

    await field.setValue('{title}')
    await flushPromises()

    expect(saveButton()?.attributes('disabled')).toBeUndefined()
  })

  it('keeps the save button disabled when the edited pattern is invalid', async () => {
    const wrapper = await mountPage()

    const field = wrapper.find('input#file-naming-file-as-book')
    await field.setValue('{title}?')
    await flushPromises()

    const error = wrapper.find('#file-naming-file-as-book-error')
    expect(error.exists()).toBe(true)
    expect(field.attributes('aria-invalid')).toBe('true')
    expect(field.attributes('aria-describedby')).toContain('file-naming-file-as-book-error')
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

  it('opens the pattern help sheet from the intro callout', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="pattern-help-sheet"]').attributes('data-open')).toBe('false')

    const calloutButton = wrapper.findAll('button').find((button) => button.text().includes('Browse tokens and examples'))
    expect(calloutButton).toBeDefined()
    await calloutButton?.trigger('click')

    expect(wrapper.find('[data-testid="pattern-help-sheet"]').attributes('data-open')).toBe('true')
  })

  it('offers a help trigger beside every pattern field label', async () => {
    const wrapper = await mountPage()

    const helpTriggers = wrapper.findAll('button[aria-label="Pattern help"]')
    // Three global pattern fields plus the library overrides section heading.
    expect(helpTriggers).toHaveLength(4)

    await helpTriggers[0]?.trigger('click')

    expect(wrapper.find('[data-testid="pattern-help-sheet"]').attributes('data-open')).toBe('true')
  })

  it('shows an empty state when no libraries are configured', async () => {
    libraries.value = []
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('No libraries configured')
  })
})
