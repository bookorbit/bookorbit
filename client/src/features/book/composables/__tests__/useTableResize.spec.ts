import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { useTableResize } from '../useTableResize'
import type { ColumnDef, ColumnId } from '../useTableColumns'

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return { ...actual, onMounted: vi.fn<(cb: () => void) => void>((cb) => cb()), onUnmounted: vi.fn<(cb: () => void) => void>() }
})

function makeDefs(): ColumnDef[] {
  return [
    { id: 'cover', header: 'Cover', defaultWidth: 60, minWidth: 40, cellType: 'cover', pinned: 'left', isEditable: false },
    { id: 'title', header: 'Title', defaultWidth: 200, minWidth: 80, cellType: 'text', pinned: null, isEditable: true, sortField: 'title' },
    { id: 'authors', header: 'Authors', defaultWidth: 150, minWidth: 80, cellType: 'chips', pinned: null, isEditable: true },
    { id: 'lockRow', header: '', defaultWidth: 28, minWidth: 28, cellType: 'text', pinned: null, isEditable: false },
  ] as ColumnDef[]
}

describe('useTableResize', () => {
  let scrollRef: Ref<HTMLDivElement | null>
  let displayColumns: Ref<ColumnDef[]>
  let setWidthSpy: (id: ColumnId, px: number) => void
  let isReadOnly: Ref<boolean>

  beforeEach(() => {
    scrollRef = ref(null)
    displayColumns = ref(makeDefs())
    setWidthSpy = vi.fn<(id: ColumnId, px: number) => void>()
    isReadOnly = ref(false)
  })

  it('returns initial state with no active resize', () => {
    const { resizingColumnId } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    expect(resizingColumnId.value).toBeNull()
  })

  it('isResizableCol returns false for lockRow', () => {
    const { isResizableCol } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    expect(isResizableCol(displayColumns.value[3]!)).toBe(false)
    expect(isResizableCol(displayColumns.value[1]!)).toBe(true)
  })

  it('isResizableCol returns false when read-only', () => {
    isReadOnly.value = true
    const { isResizableCol } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    expect(isResizableCol(displayColumns.value[1]!)).toBe(false)
  })

  it('startResize sets resizing state', () => {
    const { startResize, resizingColumnId } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    const event = { clientX: 100, preventDefault: vi.fn<() => void>() } as unknown as MouseEvent
    startResize(event, 'title', 200)
    expect(resizingColumnId.value).toBe('title')
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('startResize does nothing when read-only', () => {
    isReadOnly.value = true
    const { startResize, resizingColumnId } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    const event = { clientX: 100, preventDefault: vi.fn<() => void>() } as unknown as MouseEvent
    startResize(event, 'title', 200)
    expect(resizingColumnId.value).toBeNull()
  })

  it('mouse move during resize calls setColumnWidth with delta', () => {
    const { startResize } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    startResize({ clientX: 100, preventDefault: vi.fn<() => void>() } as unknown as MouseEvent, 'title', 200)

    const moveEvent = new MouseEvent('mousemove', { clientX: 130 })
    document.dispatchEvent(moveEvent)

    expect(setWidthSpy).toHaveBeenCalledWith('title', 230)
  })

  it('mouseup stops resize', () => {
    const { startResize, resizingColumnId } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    startResize({ clientX: 100, preventDefault: vi.fn<() => void>() } as unknown as MouseEvent, 'title', 200)
    expect(resizingColumnId.value).toBe('title')

    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(resizingColumnId.value).toBeNull()
  })

  it('mouse move without active resize does not call setColumnWidth', () => {
    useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }))
    expect(setWidthSpy).not.toHaveBeenCalled()
  })

  it('autoFitColumn measures cells by data-col-id instead of nth-child', () => {
    scrollRef.value = document.createElement('div')
    scrollRef.value.innerHTML = `
      <table>
        <thead>
          <tr>
            <th><div data-col-label>Selection</div></th>
            <th data-col-id="title"><div data-col-label>Title</div></th>
            <th data-col-id="authors"><div data-col-label>Authors</div></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>checkbox</td>
            <td data-col-id="title">A very long book title</td>
            <td data-col-id="authors">Short</td>
          </tr>
        </tbody>
      </table>
    `

    const titleHeader = scrollRef.value.querySelector('thead [data-col-id="title"] [data-col-label]') as HTMLElement
    Object.defineProperty(titleHeader, 'scrollWidth', { configurable: true, value: 120 })
    const titleCell = scrollRef.value.querySelector('tbody td[data-col-id="title"]') as HTMLElement
    Object.defineProperty(titleCell, 'scrollWidth', { configurable: true, value: 180 })

    const { autoFitColumn } = useTableResize(scrollRef, displayColumns, setWidthSpy, isReadOnly)
    autoFitColumn('title')

    expect(setWidthSpy).toHaveBeenCalledWith('title', 196)
  })
})
