import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { useTableDragReorder } from '../useTableDragReorder'
import type { ColumnDef, ColumnId } from '../useTableColumns'

function makeColumns(): ColumnDef[] {
  return [
    { id: 'cover', header: 'Cover', defaultWidth: 60, minWidth: 40, cellType: 'cover', pinned: 'left', isEditable: false },
    { id: 'title', header: 'Title', defaultWidth: 200, minWidth: 80, cellType: 'text', pinned: null, isEditable: true },
    { id: 'authors', header: 'Authors', defaultWidth: 150, minWidth: 80, cellType: 'chips', pinned: null, isEditable: true },
    { id: 'rating', header: 'Rating', defaultWidth: 80, minWidth: 60, cellType: 'rating', pinned: null, isEditable: true },
    { id: 'actions', header: '', defaultWidth: 50, minWidth: 50, cellType: 'actions', pinned: 'right', isEditable: false },
  ] as ColumnDef[]
}

describe('useTableDragReorder', () => {
  let allColumns: Ref<ColumnDef[]>
  let setOrderSpy: (order: ColumnId[]) => void

  beforeEach(() => {
    allColumns = ref(makeColumns())
    setOrderSpy = vi.fn<(order: ColumnId[]) => void>()
  })

  it('isDraggableCol returns false for pinned columns', () => {
    const { isDraggableCol } = useTableDragReorder(allColumns, setOrderSpy)
    expect(isDraggableCol(allColumns.value[0]!)).toBe(false)
    expect(isDraggableCol(allColumns.value[4]!)).toBe(false)
    expect(isDraggableCol(allColumns.value[1]!)).toBe(true)
  })

  it('drag start sets dragSourceColId', () => {
    const { handleColDragStart, dragSourceColId } = useTableDragReorder(allColumns, setOrderSpy)
    const event = { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent
    handleColDragStart(event, 'title')
    expect(dragSourceColId.value).toBe('title')
    expect(event.dataTransfer!.effectAllowed).toBe('move')
  })

  it('drag over sets drop target and side', () => {
    const { handleColDragStart, handleColDragOver, dropTargetColId, dropSide } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'title',
    )

    const target = document.createElement('div')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 30,
      height: 30,
      x: 100,
      y: 0,
      toJSON: vi.fn<() => object>(),
    })

    const overEvent = {
      clientX: 150,
      preventDefault: vi.fn<() => void>(),
      currentTarget: target,
      dataTransfer: { dropEffect: '' },
    } as unknown as DragEvent
    handleColDragOver(overEvent, allColumns.value[2]!)

    expect(dropTargetColId.value).toBe('authors')
    expect(dropSide.value).toBe('before')
  })

  it('drag over on the right side of target sets "after"', () => {
    const { handleColDragStart, handleColDragOver, dropSide } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'title',
    )

    const target = document.createElement('div')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 30,
      height: 30,
      x: 100,
      y: 0,
      toJSON: vi.fn<() => object>(),
    })

    const overEvent = {
      clientX: 250,
      preventDefault: vi.fn<() => void>(),
      currentTarget: target,
      dataTransfer: { dropEffect: '' },
    } as unknown as DragEvent
    handleColDragOver(overEvent, allColumns.value[2]!)
    expect(dropSide.value).toBe('after')
  })

  it('drag over same column does nothing', () => {
    const { handleColDragStart, handleColDragOver, dropTargetColId } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'title',
    )

    const target = document.createElement('div')
    const overEvent = {
      clientX: 150,
      preventDefault: vi.fn<() => void>(),
      currentTarget: target,
      dataTransfer: { dropEffect: '' },
    } as unknown as DragEvent
    handleColDragOver(overEvent, allColumns.value[1]!)
    expect(dropTargetColId.value).toBeNull()
  })

  it('drag leave clears drop target for matching column', () => {
    const { handleColDragStart, handleColDragOver, handleColDragLeave, dropTargetColId } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'title',
    )

    const target = document.createElement('div')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 30,
      height: 30,
      x: 100,
      y: 0,
      toJSON: vi.fn<() => object>(),
    })
    handleColDragOver(
      { clientX: 150, preventDefault: vi.fn<() => void>(), currentTarget: target, dataTransfer: { dropEffect: '' } } as unknown as DragEvent,
      allColumns.value[2]!,
    )
    expect(dropTargetColId.value).toBe('authors')

    handleColDragLeave('authors')
    expect(dropTargetColId.value).toBeNull()
  })

  it('drag leave ignores non-matching column', () => {
    const { handleColDragStart, handleColDragOver, handleColDragLeave, dropTargetColId } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'title',
    )

    const target = document.createElement('div')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 30,
      height: 30,
      x: 100,
      y: 0,
      toJSON: vi.fn<() => object>(),
    })
    handleColDragOver(
      { clientX: 150, preventDefault: vi.fn<() => void>(), currentTarget: target, dataTransfer: { dropEffect: '' } } as unknown as DragEvent,
      allColumns.value[2]!,
    )

    handleColDragLeave('rating')
    expect(dropTargetColId.value).toBe('authors')
  })

  it('drop reorders columns preserving pinned', () => {
    const { handleColDragStart, handleColDragOver, handleColDrop, dragSourceColId } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'rating',
    )

    const target = document.createElement('div')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 30,
      height: 30,
      x: 100,
      y: 0,
      toJSON: vi.fn<() => object>(),
    })
    handleColDragOver(
      { clientX: 150, preventDefault: vi.fn<() => void>(), currentTarget: target, dataTransfer: { dropEffect: '' } } as unknown as DragEvent,
      allColumns.value[1]!,
    )

    handleColDrop({ preventDefault: vi.fn<() => void>() } as unknown as DragEvent, 'title')
    expect(setOrderSpy).toHaveBeenCalledWith(['cover', 'rating', 'title', 'authors', 'actions'])
    expect(dragSourceColId.value).toBeNull()
  })

  it('drop same column resets state without calling setColumnOrder', () => {
    const { handleColDragStart, handleColDrop, dragSourceColId } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'title',
    )
    handleColDrop({ preventDefault: vi.fn<() => void>() } as unknown as DragEvent, 'title')
    expect(setOrderSpy).not.toHaveBeenCalled()
    expect(dragSourceColId.value).toBeNull()
  })

  it('dragEnd resets all state', () => {
    const { handleColDragStart, handleColDragEnd, dragSourceColId, dropTargetColId, dropSide } = useTableDragReorder(allColumns, setOrderSpy)
    handleColDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn<(format: string, data: string) => void>() } } as unknown as DragEvent,
      'title',
    )
    handleColDragEnd()
    expect(dragSourceColId.value).toBeNull()
    expect(dropTargetColId.value).toBeNull()
    expect(dropSide.value).toBeNull()
  })
})
