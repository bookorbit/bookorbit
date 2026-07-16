import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../useAnnotations'
import { useReaderAnnotationActions } from '../useReaderAnnotationActions'

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 42,
    bookId: 9,
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
    jumpFileId: 33,
    pageno: null,
    text: 'Selected text',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'Intro',
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeHarness(initialAnnotations: Annotation[] = []) {
  const annotationItems = ref<Annotation[]>(initialAnnotations)
  const create = vi.fn<() => Promise<Annotation | null>>()
  const update = vi.fn<() => Promise<Annotation | null>>()
  const addAnnotation = vi.fn<(cfi: string, color: string, style: string) => void>()
  const redrawAnnotation = vi.fn<(cfi: string, color: string, style: string) => void>()

  const selection = {
    text: ref('Selected text'),
    cfi: ref<string | null>('epubcfi(/6/4!/4/2,/1:0,/1:10)'),
    overlappingAnnotationId: ref<number | null>(null),
    showNoteDialog: ref(false),
    noteText: ref(''),
    dismiss: vi.fn<() => void>(),
    openNoteDialog: vi.fn<(initialNote?: string) => void>((initialNote = '') => {
      selection.noteText.value = initialNote
      selection.showNoteDialog.value = true
      selection.dismiss()
    }),
  }

  const actions = useReaderAnnotationActions({
    bookId: 9,
    fileId: 33,
    chapterTitle: ref('Intro'),
    annotations: {
      annotations: annotationItems,
      create,
      update,
    },
    selection,
    addAnnotation,
    redrawAnnotation,
  })

  return { actions, annotationItems, create, update, addAnnotation, redrawAnnotation, selection }
}

describe('useReaderAnnotationActions', () => {
  it('creates and draws a new highlight when the selection does not overlap an existing annotation', async () => {
    const created = makeAnnotation({ id: 99, color: '#38BDF8', style: 'underline' })
    const { actions, create, update, addAnnotation, redrawAnnotation, selection } = makeHarness()
    create.mockResolvedValueOnce(created)

    await actions.handleHighlight('#38BDF8', 'underline')

    expect(create).toHaveBeenCalledWith(9, {
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
      bookFileId: 33,
      text: 'Selected text',
      color: '#38BDF8',
      style: 'underline',
      note: null,
      chapterTitle: 'Intro',
    })
    expect(update).not.toHaveBeenCalled()
    expect(addAnnotation).toHaveBeenCalledWith(created.cfi, '#38BDF8', 'underline')
    expect(redrawAnnotation).not.toHaveBeenCalled()
    expect(selection.dismiss).toHaveBeenCalledTimes(1)
  })

  it('updates and redraws an existing annotation instead of creating a duplicate', async () => {
    const existing = makeAnnotation({ id: 42, color: '#FACC15', style: 'highlight' })
    const updated = makeAnnotation({ id: 42, color: '#F472B6', style: 'squiggly' })
    const { actions, create, update, addAnnotation, redrawAnnotation, selection } = makeHarness([existing])
    selection.overlappingAnnotationId.value = 42
    update.mockResolvedValueOnce(updated)

    await actions.handleHighlight('#F472B6', 'squiggly')

    expect(update).toHaveBeenCalledWith(9, 42, { color: '#F472B6', style: 'squiggly' })
    expect(create).not.toHaveBeenCalled()
    expect(addAnnotation).not.toHaveBeenCalled()
    expect(redrawAnnotation).toHaveBeenCalledWith(updated.cfi, '#F472B6', 'squiggly')
    expect(selection.dismiss).toHaveBeenCalledTimes(1)
  })

  it('saves a note onto an existing annotation without changing its drawn style', async () => {
    const existing = makeAnnotation({ id: 42, note: 'old note' })
    const updated = makeAnnotation({ id: 42, note: 'edited note' })
    const { actions, create, update, redrawAnnotation, selection } = makeHarness([existing])
    selection.overlappingAnnotationId.value = 42
    selection.showNoteDialog.value = true
    selection.noteText.value = 'draft'
    update.mockResolvedValueOnce(updated)

    await actions.handleSaveNote('edited note')

    expect(update).toHaveBeenCalledWith(9, 42, { note: 'edited note' })
    expect(create).not.toHaveBeenCalled()
    expect(redrawAnnotation).not.toHaveBeenCalled()
    expect(selection.showNoteDialog.value).toBe(false)
    expect(selection.noteText.value).toBe('')
  })

  it('creates a default highlight with the saved note when annotating new text', async () => {
    const created = makeAnnotation({ id: 99, note: 'new note' })
    const { actions, create, update, addAnnotation, selection } = makeHarness()
    selection.showNoteDialog.value = true
    selection.noteText.value = 'draft'
    create.mockResolvedValueOnce(created)

    await actions.handleSaveNote('new note')

    expect(create).toHaveBeenCalledWith(9, expect.objectContaining({ color: '#FACC15', style: 'highlight', note: 'new note' }))
    expect(update).not.toHaveBeenCalled()
    expect(addAnnotation).toHaveBeenCalledWith(created.cfi, '#FACC15', 'highlight')
    expect(selection.showNoteDialog.value).toBe(false)
    expect(selection.noteText.value).toBe('')
  })

  it('opens the note dialog with the existing annotation note when available', () => {
    const existing = makeAnnotation({ id: 42, note: 'old note' })
    const { actions, selection } = makeHarness([existing])
    selection.overlappingAnnotationId.value = 42

    actions.handleOpenNoteDialog()

    expect(selection.openNoteDialog).toHaveBeenCalledWith('old note')
    expect(selection.noteText.value).toBe('old note')
    expect(selection.showNoteDialog.value).toBe(true)
  })
})
