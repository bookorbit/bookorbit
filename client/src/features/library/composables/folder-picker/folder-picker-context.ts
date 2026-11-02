import { inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { OrganizationMode } from '@bookorbit/types'
import type { FolderStatus, PickerLibrary } from './folder-picker-rules'
import type { FolderPickerData } from './useFolderPickerData'
import type { FolderPickerSelection } from './useFolderPickerSelection'
import type { FolderPickerTree } from './useFolderPickerTree'

export interface FolderPickerContext {
  data: FolderPickerData
  tree: FolderPickerTree
  selection: FolderPickerSelection
  /** Every library with folders, this one included and marked `self`. */
  libraries: ComputedRef<PickerLibrary[]>
  others: ComputedRef<PickerLibrary[]>
  own: ComputedRef<string[]>
  libraryName: ComputedRef<string>
  mode: Ref<OrganizationMode>
  modeLocked: ComputedRef<boolean>
  phone: Ref<boolean>
  /** A folder just revealed, tinted for a moment so the eye finds it. */
  flash: Ref<string | null>
  /** The text being found by name, for highlighting matches. */
  findQuery: Ref<string>
  newFolder: { name: Ref<string>; error: Ref<string | null>; busy: Ref<boolean> }
  /** The View menu is open; Escape then closes the menu, not the picker. */
  menuOpen: Ref<boolean>
  reveal: (path: string) => void
  focusFolder: (path: string) => void
  toggleFolder: (path: string, event?: MouseEvent | KeyboardEvent) => void
  openNewFolder: (parent: string) => void
  submitNewFolder: () => Promise<void>
  cancelNewFolder: () => void
  booksIn: (path: string) => number | null
  /** "3 books". */
  countLabel: (count: number) => string
  /** Why ticking a folder would put books in two libraries, for a status that warns. */
  describeOverlap: (path: string, status: FolderStatus) => string
}

export const FOLDER_PICKER: InjectionKey<FolderPickerContext> = Symbol('folder-picker')

export function useFolderPickerContext(): FolderPickerContext {
  const context = inject(FOLDER_PICKER)
  if (!context) throw new Error('Folder picker parts need the context provided by FolderPickerModal')
  return context
}
