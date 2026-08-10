import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMovePreviewResult, BookSelectionPayload, Library } from '@bookorbit/types'
import MoveToLibrarySheet from '../MoveToLibrarySheet.vue'

const { librariesRef, fetchLibrariesMock, refreshLibrariesMock, fetchMovePreviewMock, executeMoveMock } = vi.hoisted(() => ({
  librariesRef: { value: [] as Library[] },
  fetchLibrariesMock: vi.fn<() => Promise<void>>(),
  refreshLibrariesMock: vi.fn<() => Promise<void>>(),
  fetchMovePreviewMock: vi.fn<(...args: unknown[]) => Promise<BookMovePreviewResult>>(),
  executeMoveMock: vi.fn<(...args: unknown[]) => Promise<Response>>(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
  },
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: librariesRef,
    fetchLibraries: fetchLibrariesMock,
    refreshLibraries: refreshLibrariesMock,
  }),
}))

vi.mock('@/composables/useVirtualKeyboard', () => ({ useVirtualKeyboard: () => ({ keyboardHeight: { value: 0 } }) }))

vi.mock('../../api/book-move', () => ({
  fetchMovePreview: (...args: unknown[]) => fetchMovePreviewMock(...args),
  executeMove: (...args: unknown[]) => executeMoveMock(...args),
}))

function makeLibrary(overrides: Partial<Library> = {}): Library {
  const id = overrides.id ?? 2
  return {
    id,
    name: 'PDFs',
    icon: 'FileText',
    folders: [{ id: id * 11, libraryId: id, path: `/lib${id}`, createdAt: '2026-01-01T00:00:00.000Z' }],
    bookCount: 9,
    ...overrides,
  } as Library
}

function makePreview(overrides: Partial<BookMovePreviewResult> = {}): BookMovePreviewResult {
  return {
    targetLibraryId: 2,
    targetFolderId: 22,
    targetOrganizationMode: 'book_per_folder',
    totalSelected: 4,
    readyCount: 4,
    ready: [],
    alreadyInTargetCount: 0,
    collisionCount: 0,
    collisions: [],
    collisionsTruncated: false,
    ineligibleCount: 0,
    ineligible: [],
    ineligibleTruncated: false,
    warnings: { accessLosers: [], koboImpact: [], layout: null, formatMismatches: [], crossDevice: false },
    requiresReview: false,
    ...overrides,
  }
}

function streamingResponse(events: unknown[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      controller.close()
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}

const globalStubs = {
  stubs: {
    Sheet: { template: '<div><slot /></div>' },
    SheetContent: { template: '<div><slot /></div>' },
    SheetHeader: { template: '<div><slot /></div>' },
    SheetTitle: { template: '<div><slot /></div>' },
    Button: {
      props: ['disabled', 'variant', 'size'],
      emits: ['click'],
      template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
    },
    Input: {
      props: ['modelValue', 'placeholder', 'class'],
      emits: ['update:modelValue'],
      template: '<input data-testid="search-input" :class="$props.class" :value="modelValue" :placeholder="placeholder" />',
    },
    AppIcon: {
      props: ['icon', 'fallback', 'size'],
      template: '<span data-testid="app-icon" :data-icon="icon" :data-fallback="fallback" />',
    },
  },
}

function mountSheet(props: { selectedCount?: number; currentLibraryId?: number | null; selectionPayload?: BookSelectionPayload } = {}) {
  return mount(MoveToLibrarySheet, {
    props: {
      open: true,
      selectionPayload: props.selectionPayload ?? { bookIds: [1, 2, 3, 4] },
      selectedCount: props.selectedCount ?? 4,
      currentLibraryId: props.currentLibraryId ?? 1,
    },
    global: globalStubs,
  })
}

function buttonByText(wrapper: ReturnType<typeof mountSheet>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  expect(button, `no button containing "${text}"`).toBeDefined()
  return button!
}

beforeEach(() => {
  librariesRef.value = [makeLibrary({ id: 1, name: 'Novels', icon: 'BookMarked', bookCount: 251 }), makeLibrary()]
  fetchLibrariesMock.mockReset().mockResolvedValue(undefined)
  refreshLibrariesMock.mockReset().mockResolvedValue(undefined)
  fetchMovePreviewMock.mockReset().mockResolvedValue(makePreview())
  executeMoveMock.mockReset()
})

describe('destination list', () => {
  it('renders each library with its own icon rather than a generic one', async () => {
    const wrapper = mountSheet()
    await flushPromises()

    const icons = wrapper.findAll('[data-testid="app-icon"]')
    expect(icons.map((icon) => icon.attributes('data-icon'))).toEqual(['BookMarked', 'FileText'])
    expect(icons[0].attributes('data-fallback')).toBe('BookCopy')
  })

  it('uses a single search control with no nested bordered wrapper', async () => {
    const wrapper = mountSheet()
    await flushPromises()

    const input = wrapper.get('[data-testid="search-input"]')
    // The icon sits inside the field via padding, so the field owns the only border.
    expect(input.attributes('class')).toContain('ps-9')
    expect(input.element.parentElement?.className).not.toContain('border')
  })

  it('disables the library the books already live in', async () => {
    const wrapper = mountSheet({ currentLibraryId: 1 })
    await flushPromises()

    const rows = wrapper.findAll('button[aria-pressed]')
    expect(rows[0].attributes('disabled')).toBeDefined()
    expect(rows[1].attributes('disabled')).toBeUndefined()
  })
})

describe('after a move', () => {
  async function runMove(wrapper: ReturnType<typeof mountSheet>) {
    await flushPromises()
    await wrapper.findAll('button[aria-pressed]')[1].trigger('click')
    await buttonByText(wrapper, 'Continue').trigger('click')
    await flushPromises()
  }

  it('keeps the count captured when the sheet opened', async () => {
    executeMoveMock.mockResolvedValue(
      streamingResponse([
        { bookId: 1, status: 'success' },
        { done: true, processed: 4, succeeded: 4, merged: 0, failed: 0, skipped: 0, cancelled: false },
      ]),
    )

    const wrapper = mountSheet({ selectedCount: 4 })
    await runMove(wrapper)

    // Finishing the move clears the selection upstream; the title must not follow it to zero.
    await wrapper.setProps({ selectedCount: 0 })
    await flushPromises()

    expect(wrapper.text()).toContain('Move 4 books')
    expect(wrapper.text()).not.toContain('Move 0 books')
  })

  it('refetches libraries so sidebar counts reflect the move', async () => {
    executeMoveMock.mockResolvedValue(
      streamingResponse([{ done: true, processed: 4, succeeded: 4, merged: 0, failed: 0, skipped: 0, cancelled: false }]),
    )

    const wrapper = mountSheet()
    await runMove(wrapper)

    expect(refreshLibrariesMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('moved')).toHaveLength(1)
  })

  it('does not refetch libraries when nothing moved', async () => {
    executeMoveMock.mockResolvedValue(
      streamingResponse([{ done: true, processed: 0, succeeded: 0, merged: 0, failed: 0, skipped: 0, cancelled: false }]),
    )

    const wrapper = mountSheet()
    await runMove(wrapper)

    expect(refreshLibrariesMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('moved')).toBeUndefined()
  })
})
