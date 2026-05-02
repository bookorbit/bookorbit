import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import { useTableKeyboard } from '../useTableKeyboard'
import type { ColumnDef, ColumnId } from '../useTableColumns'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    title: 'Test Book',
    authors: ['Author A'],
    genres: [],
    tags: [],
    files: [],
    rating: 4,
    pageCount: 300,
    readStatus: { status: 'unread', progress: 0 },
    ...overrides,
  } as BookCard
}

function makeColumns(): ColumnDef[] {
  return [
    { id: 'title', header: 'Title', defaultWidth: 200, minWidth: 80, cellType: 'text', pinned: null, isEditable: true },
    { id: 'authors', header: 'Authors', defaultWidth: 150, minWidth: 80, cellType: 'chips', pinned: null, isEditable: true },
    { id: 'rating', header: 'Rating', defaultWidth: 80, minWidth: 60, cellType: 'rating', pinned: null, isEditable: false },
  ] as ColumnDef[]
}

describe('useTableKeyboard', () => {
  let books: BookCard[]
  let displayColumns: Ref<ColumnDef[]>
  let activeCellKey: Ref<string | null>
  let onActivate: (book: BookCard, colId: ColumnId) => void
  let onSelect: (id: number, event: MouseEvent) => void
  let scrollToIndexSpy: ReturnType<typeof vi.fn>

  function createKeyboard() {
    return useTableKeyboard({
      books: () => books,
      displayColumns,
      activeCellKey,
      selectionMode: () => false,
      isReadOnly: () => false,
      virtualizer: { value: { scrollToIndex: scrollToIndexSpy } } as unknown as ReturnType<typeof import('@tanstack/vue-virtual').useVirtualizer>,
      isCellReadOnly: () => false,
      onActivate,
      onSelect,
    })
  }

  function keyEvent(key: string, extras: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return { key, preventDefault: vi.fn<() => void>(), ctrlKey: false, metaKey: false, ...extras } as unknown as KeyboardEvent
  }

  beforeEach(() => {
    books = [makeBook({ id: 1, title: 'Book A' }), makeBook({ id: 2, title: 'Book B' }), makeBook({ id: 3, title: 'Book C' })]
    displayColumns = ref(makeColumns())
    activeCellKey = ref(null)
    onActivate = vi.fn<(book: BookCard, colId: ColumnId) => void>()
    onSelect = vi.fn<(id: number, event: MouseEvent) => void>()
    scrollToIndexSpy = vi.fn<() => void>()
  })

  it('ArrowDown initializes focus to first row first col', () => {
    const { handleTableKeydown, focusedRowIndex, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    expect(focusedRowIndex.value).toBe(0)
    expect(focusedColIndex.value).toBe(0)
  })

  it('ArrowDown moves focus down', () => {
    const { handleTableKeydown, focusedRowIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowDown'))
    expect(focusedRowIndex.value).toBe(1)
  })

  it('ArrowDown clamps to last row', () => {
    const { handleTableKeydown, focusedRowIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowDown'))
    expect(focusedRowIndex.value).toBe(2)
  })

  it('ArrowUp moves focus up', () => {
    const { handleTableKeydown, focusedRowIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowUp'))
    expect(focusedRowIndex.value).toBe(0)
  })

  it('ArrowUp clamps to first row', () => {
    const { handleTableKeydown, focusedRowIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowUp'))
    handleTableKeydown(keyEvent('ArrowUp'))
    expect(focusedRowIndex.value).toBe(0)
  })

  it('ArrowRight moves col focus', () => {
    const { handleTableKeydown, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowRight'))
    expect(focusedColIndex.value).toBe(1)
  })

  it('ArrowRight clamps to last column', () => {
    const { handleTableKeydown, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowRight'))
    handleTableKeydown(keyEvent('ArrowRight'))
    handleTableKeydown(keyEvent('ArrowRight'))
    expect(focusedColIndex.value).toBe(2)
  })

  it('ArrowLeft moves col focus back', () => {
    const { handleTableKeydown, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowRight'))
    handleTableKeydown(keyEvent('ArrowLeft'))
    expect(focusedColIndex.value).toBe(0)
  })

  it('Home jumps to first column', () => {
    const { handleTableKeydown, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowRight'))
    handleTableKeydown(keyEvent('ArrowRight'))
    handleTableKeydown(keyEvent('Home'))
    expect(focusedColIndex.value).toBe(0)
  })

  it('Ctrl+Home jumps to first row and first column', () => {
    const { handleTableKeydown, focusedRowIndex, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('ArrowRight'))
    handleTableKeydown(keyEvent('Home', { ctrlKey: true }))
    expect(focusedRowIndex.value).toBe(0)
    expect(focusedColIndex.value).toBe(0)
  })

  it('End jumps to last column', () => {
    const { handleTableKeydown, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('End'))
    expect(focusedColIndex.value).toBe(2)
  })

  it('Ctrl+End jumps to last row and last column', () => {
    const { handleTableKeydown, focusedRowIndex, focusedColIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('End', { ctrlKey: true }))
    expect(focusedRowIndex.value).toBe(2)
    expect(focusedColIndex.value).toBe(2)
  })

  it('Enter does not activate edit mode', () => {
    const { handleTableKeydown } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('Enter'))
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('Space in selection mode calls onSelect', () => {
    const keyboard = useTableKeyboard({
      books: () => books,
      displayColumns,
      activeCellKey,
      selectionMode: () => true,
      isReadOnly: () => false,
      virtualizer: { value: { scrollToIndex: scrollToIndexSpy } } as unknown as ReturnType<typeof import('@tanstack/vue-virtual').useVirtualizer>,
      isCellReadOnly: () => false,
      onActivate,
      onSelect,
    })
    keyboard.handleTableKeydown(keyEvent('ArrowDown'))
    keyboard.handleTableKeydown(keyEvent(' '))
    expect(onSelect).toHaveBeenCalledWith(1, expect.anything())
  })

  it('does nothing when activeCell is set', () => {
    activeCellKey.value = '1:title'
    const { handleTableKeydown, focusedRowIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    expect(focusedRowIndex.value).toBeNull()
  })

  it('Cmd/Ctrl+C still copies when a cell editor is active', () => {
    const writeTextSpy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } })

    activeCellKey.value = '2:title'
    const { handleTableKeydown } = createKeyboard()
    handleTableKeydown(keyEvent('c', { metaKey: true }))

    expect(writeTextSpy).toHaveBeenCalledWith('Book B')

    vi.unstubAllGlobals()
  })

  it('Cmd/Ctrl+Shift+C still copies row when a cell editor is active', () => {
    const writeTextSpy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } })

    activeCellKey.value = '2:title'
    const { handleTableKeydown } = createKeyboard()
    handleTableKeydown(keyEvent('C', { metaKey: true, shiftKey: true }))

    expect(writeTextSpy).toHaveBeenCalledWith('Title: Book B\nAuthors: Author A\nRating: 4')

    vi.unstubAllGlobals()
  })

  it('Cmd/Ctrl+C resolves target cell from keyboard event DOM target', () => {
    const writeTextSpy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } })

    const cell = document.createElement('td')
    cell.dataset.colId = 'title'
    cell.dataset.rowIndex = '1'
    document.body.appendChild(cell)

    const { handleTableKeydown } = createKeyboard()
    handleTableKeydown(keyEvent('c', { metaKey: true, target: cell }))

    expect(writeTextSpy).toHaveBeenCalledWith('Book B')

    cell.remove()
    vi.unstubAllGlobals()
  })

  it('does nothing with empty books array', () => {
    books = []
    const { handleTableKeydown, focusedRowIndex } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    expect(focusedRowIndex.value).toBeNull()
  })

  it('isFocusedCell returns correct boolean', () => {
    const { handleTableKeydown, isFocusedCell } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    expect(isFocusedCell(0, 0)).toBe(true)
    expect(isFocusedCell(1, 0)).toBe(false)
  })

  it('Ctrl+C copies focused cell value to clipboard', () => {
    const writeTextSpy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } })

    const { handleTableKeydown } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('c', { ctrlKey: true }))
    expect(writeTextSpy).toHaveBeenCalledWith('Book A')

    vi.unstubAllGlobals()
  })

  it('Ctrl+Shift+C copies the focused row when key is uppercase C', () => {
    const writeTextSpy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } })

    const { handleTableKeydown } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    handleTableKeydown(keyEvent('C', { ctrlKey: true, shiftKey: true }))

    expect(writeTextSpy).toHaveBeenCalledWith('Title: Book A\nAuthors: Author A\nRating: 4')

    vi.unstubAllGlobals()
  })

  it('scrollToIndex is called when moving rows', () => {
    const { handleTableKeydown } = createKeyboard()
    handleTableKeydown(keyEvent('ArrowDown'))
    expect(scrollToIndexSpy).toHaveBeenCalledWith(0, { align: 'auto' })
  })
})
