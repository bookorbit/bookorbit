import { describe, expect, it } from 'vitest'
import { joinErrorMessageKey, useBookDockJoinChoices } from '../useBookDockJoinChoices'

describe('useBookDockJoinChoices', () => {
  it('sends a join override only for files with a choice, and only for the files asked about', () => {
    const joins = useBookDockJoinChoices()
    expect(joins.hasChoices.value).toBe(false)
    expect(joins.overrides()).toEqual([])

    joins.choose(10, { bookId: 42, title: 'Dune' })
    joins.choose(11, { bookId: 43, title: null })

    expect(joins.hasChoices.value).toBe(true)
    expect(joins.choiceFor(10)).toEqual({ bookId: 42, title: 'Dune' })
    expect(joins.overrides()).toEqual([
      { fileId: 10, joinBook: { bookId: 42 } },
      { fileId: 11, joinBook: { bookId: 43 } },
    ])
    expect(joins.overrides([11, 99])).toEqual([{ fileId: 11, joinBook: { bookId: 43 } }])
  })

  it('closes the picker of the file that got a book and keeps one picker open at a time', () => {
    const joins = useBookDockJoinChoices()
    joins.openPicker(10)
    joins.openPicker(11)
    expect(joins.pickerFileId.value).toBe(11)

    joins.choose(10, { bookId: 42, title: 'Dune' })
    expect(joins.pickerFileId.value).toBe(11)
    joins.choose(11, { bookId: 42, title: 'Dune' })
    expect(joins.pickerFileId.value).toBeNull()
  })

  it('files a book as new again, and forgets files that left the review', () => {
    const joins = useBookDockJoinChoices()
    joins.choose(10, { bookId: 42, title: 'Dune' })
    joins.choose(11, { bookId: 43, title: 'Emma' })
    joins.openPicker(12)

    joins.clear(10)
    expect(joins.choiceFor(10)).toBeUndefined()

    const before = joins.choices.value
    joins.forget([99])
    expect(joins.choices.value).toBe(before)

    joins.forget([11, 12])
    expect(joins.hasChoices.value).toBe(false)
    expect(joins.pickerFileId.value).toBeNull()
  })
})

describe('joinErrorMessageKey', () => {
  it('reads an unknown or missing code as a plain refusal', () => {
    expect(joinErrorMessageKey('BOOK_DOCK_JOIN_FILE_PER_BOOK')).toBe('bookDock.finalizeDialog.join.error.BOOK_DOCK_JOIN_FILE_PER_BOOK')
    expect(joinErrorMessageKey('BOOK_DOCK_JOIN_SOMETHING_NEW')).toBe('bookDock.finalizeDialog.join.error.generic')
    expect(joinErrorMessageKey(undefined)).toBe('bookDock.finalizeDialog.join.error.generic')
  })
})
