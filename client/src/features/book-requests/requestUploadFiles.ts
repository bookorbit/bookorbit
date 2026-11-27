import { BOOK_REQUEST_UPLOAD_MAX_FILES } from '@bookorbit/types'

/** A file someone handed the request, with the path it had inside whatever was picked. */
export interface PickedUploadFile {
  file: File
  /** `/` separated; just the name for a loose file, `Folder/CD 1/01.mp3` for a dropped folder. */
  path: string
}

/** How deep a dropped folder is read. The import reads four levels below the release. */
const MAX_DROP_DEPTH = 6

/** Files picked through an input, which keep their folder only when a folder was picked. */
export function pickedFromInput(list: FileList | File[]): PickedUploadFile[] {
  return [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

/**
 * Everything a drop carried, folders walked. Bounded one past the upload limit, so a drop that is
 * too large is still recognised as too large without walking a whole disk to say so.
 */
export async function pickedFromDrop(transfer: DataTransfer): Promise<PickedUploadFile[]> {
  const entries = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null)
  if (entries.length === 0) return pickedFromInput(transfer.files)

  const found: PickedUploadFile[] = []
  const limit = BOOK_REQUEST_UPLOAD_MAX_FILES + 1
  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (found.length >= limit || depth > MAX_DROP_DEPTH) return
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)))
      if (file) found.push({ file, path: entry.fullPath.replace(/^\/+/, '') || file.name })
      return
    }
    if (!entry.isDirectory) return
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])))
      if (batch.length === 0) return
      for (const child of batch) await walk(child, depth + 1)
      if (found.length >= limit) return
    }
  }
  for (const entry of entries) await walk(entry, 0)
  return found
}

/** Whether a drag carries files at all, rather than text or a link. */
export function dragCarriesFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

/** Adds newly picked files, a path picked again replacing the earlier one. */
export function mergePicked(current: PickedUploadFile[], added: PickedUploadFile[]): PickedUploadFile[] {
  const byPath = new Map(current.map((entry) => [entry.path, entry]))
  for (const entry of added) byPath.set(entry.path, entry)
  return [...byPath.values()]
}

export function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
