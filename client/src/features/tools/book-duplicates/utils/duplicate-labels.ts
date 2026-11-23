import type { BookDuplicateAction, BookDuplicateBookAction, BookDuplicateBookOutcome, BookDuplicateKind } from '@bookorbit/types'

/** The locale key naming an action for a group of this kind: linking other editions reads as linking editions. */
export function duplicateActionKey(kind: BookDuplicateKind, action: BookDuplicateBookAction): string {
  return kind === 'other_edition' && action === 'link' ? 'tools.bookDuplicates.actions.linkEditions' : `tools.bookDuplicates.actions.${action}`
}

/** The locale key for turning a suggestion down: editions are not duplicates to begin with. */
export function duplicateDismissKey(kind: BookDuplicateKind): string {
  return kind === 'other_edition' ? 'tools.bookDuplicates.notEditions' : 'tools.bookDuplicates.notDuplicates'
}

/** The locale key for a copy's role in the comparison. Linked other editions are named as editions. */
export function duplicateCopyStatusKey(kind: BookDuplicateKind | undefined, keeper: boolean, action: BookDuplicateAction | null | undefined): string {
  const editions = kind === 'other_edition' && action === 'link'
  if (keeper) {
    if (editions) return 'tools.bookDuplicates.copyStatus.mainEdition'
    return action === 'link' ? 'tools.bookDuplicates.copyStatus.main' : 'tools.bookDuplicates.keeping'
  }
  if (editions) return 'tools.bookDuplicates.copyStatus.otherEdition'
  switch (action) {
    case 'delete':
      return 'tools.bookDuplicates.willDelete'
    case 'merge':
      return 'tools.bookDuplicates.copyStatus.merge'
    case 'link':
      return 'tools.bookDuplicates.copyStatus.link'
    default:
      return 'tools.bookDuplicates.copyStatus.other'
  }
}

/** The locale key for a book's result after a run: other editions that were linked read as grouped. */
export function duplicateBookOutcomeKey(kind: BookDuplicateKind, status: BookDuplicateBookOutcome['status']): string {
  return kind === 'other_edition' && status === 'linked' ? 'tools.bookDuplicates.bookOutcomes.grouped' : `tools.bookDuplicates.bookOutcomes.${status}`
}
