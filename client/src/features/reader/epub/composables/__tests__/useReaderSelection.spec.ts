import { describe, expect, it } from 'vitest'
import { useReaderSelection } from '../useReaderSelection'

describe('useReaderSelection', () => {
  it('shows selection popup with provided details', () => {
    const selection = useReaderSelection()
    selection.overlappingAnnotationId.value = 99

    selection.show({
      text: 'Selected text',
      cfi: 'epubcfi(/6/2)',
      popupPosition: { x: 120, y: 240, showBelow: true },
    })

    expect(selection.visible.value).toBe(true)
    expect(selection.text.value).toBe('Selected text')
    expect(selection.cfi.value).toBe('epubcfi(/6/2)')
    expect(selection.position.value).toEqual({ x: 120, y: 240 })
    expect(selection.showBelow.value).toBe(true)
    expect(selection.overlappingAnnotationId.value).toBeNull()
  })

  it('dismisses popup and opens note dialog with clean note body', () => {
    const selection = useReaderSelection()
    selection.visible.value = true
    selection.noteText.value = 'old note'

    selection.openNoteDialog()

    expect(selection.showNoteDialog.value).toBe(true)
    expect(selection.noteText.value).toBe('')
    expect(selection.visible.value).toBe(false)

    selection.dismiss()
    expect(selection.visible.value).toBe(false)
  })
})
