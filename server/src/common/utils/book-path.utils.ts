import { dirname, resolve } from 'path';

export function resolveSingleFileBookPath(absolutePath: string, libraryFolderPath: string, organizationMode: string | null | undefined): string {
  const parent = dirname(absolutePath);
  // The scanner treats root-level content files as separate books even in Folder as Book mode.
  return organizationMode === 'book_per_file' || resolve(parent) === resolve(libraryFolderPath) ? absolutePath : parent;
}
