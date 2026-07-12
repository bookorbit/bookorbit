import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FolderPickerModal from '../FolderPickerModal.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

const tooltipStubs = {
  Teleport: true,
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
}

describe('FolderPickerModal', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/v1/path/config') return jsonResponse({ root: '/books' })
      if (url === '/api/v1/path?path=%2Fbooks') return jsonResponse([{ name: 'Sci-Fi', path: '/books/Sci-Fi' }])
      if (url === '/api/v1/path?path=%2Fbooks%2FSci-Fi') return jsonResponse([])
      if (url === '/api/v1/path' && init?.method === 'POST') return jsonResponse({ name: 'New', path: '/books/New' })
      return jsonResponse({}, 404)
    })
  })

  it('loads the configured browse root before listing folders', async () => {
    const wrapper = mountPicker()
    await flushPromises()

    expect(apiMock).toHaveBeenNthCalledWith(1, '/api/v1/path/config')
    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/v1/path?path=%2Fbooks')
    expect(wrapper.text()).toContain('/books')
    expect(wrapper.text()).toContain('Sci-Fi')
  })

  it('does not navigate above the configured browse root', async () => {
    const wrapper = mountPicker()
    await flushPromises()

    await wrapper.get('button[aria-label="Open Sci-Fi"]').trigger('click')
    await flushPromises()
    await (wrapper.vm as unknown as { goUp: () => Promise<void> }).goUp()

    expect((wrapper.vm as unknown as { currentPath: string }).currentPath).toBe('/books')
  })

  it('selects multiple folders without navigating into them', async () => {
    const wrapper = mountPicker()
    await flushPromises()

    await folderRow(wrapper, 'Sci-Fi').get('input[type="checkbox"]').setValue(true)
    await buttonByText(wrapper, 'Add 1 folder').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[['/books/Sci-Fi']]])
    expect((wrapper.vm as unknown as { currentPath: string }).currentPath).toBe('/books')
  })

  it('marks folders that are already part of the library', async () => {
    const wrapper = mountPicker(['/books/Sci-Fi'])
    await flushPromises()

    const row = folderRow(wrapper, 'Sci-Fi')
    expect(row.text()).toContain('Already added')
    expect(row.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  })

  it('creates folders under the configured browse root', async () => {
    const wrapper = mountPicker()
    await flushPromises()

    await buttonByText(wrapper, 'New folder').trigger('click')
    await wrapper.get('input[placeholder="New folder name"]').setValue('New')
    await buttonByText(wrapper, 'Create').trigger('click')
    await flushPromises()

    const createCall = apiMock.mock.calls.find(([url, init]) => String(url) === '/api/v1/path' && init?.method === 'POST')
    expect(JSON.parse(createCall?.[1]?.body as string)).toEqual({ parentPath: '/books', name: 'New' })
  })
})

function mountPicker(selectedPaths: string[] = []) {
  return mount(FolderPickerModal, {
    props: { selectedPaths },
    global: {
      stubs: tooltipStubs,
    },
  })
}

function buttonByText(wrapper: ReturnType<typeof mountPicker>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function folderRow(wrapper: ReturnType<typeof mountPicker>, text: string) {
  const row = wrapper.findAll('label').find((candidate) => candidate.text().includes(text))
  if (!row) throw new Error(`Folder row not found: ${text}`)
  return row
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
