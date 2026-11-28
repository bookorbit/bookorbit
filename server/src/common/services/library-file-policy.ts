import { ConflictException, ForbiddenException } from '@nestjs/common';

export const READ_ONLY_LIBRARY_MESSAGE = 'This library is read-only.';

function libraryBusyError(): ConflictException {
  return new ConflictException({ errorCode: 'LIBRARY_BUSY', message: 'Wait for the active library operation to finish.' });
}

export function readOnlyLibraryError(): ForbiddenException {
  return new ForbiddenException({ errorCode: 'LIBRARY_READ_ONLY', message: READ_ONLY_LIBRARY_MESSAGE });
}

/** Single-process coordination, like LibraryOperationGate. Concurrent writers may share a
 * library, but a settings change cannot cut through a write or its rollback. */
export class LibraryFilePolicy {
  private readonly writes = new Map<number, number>();
  // Path-based writers resolve their library from the current folder list. Keep that list stable
  // until their filesystem operation finishes, including writes that initially match no library.
  private pathWriters = 0;
  private editingRoots = false;
  private readonly changing = new Set<number>();
  // A plan or a database read may have started before a settings change finished.
  private readonly enabledSinceBoot = new Set<number>();

  private editingLibrary?: number;

  beginRootChange(id?: number): Disposable {
    if (this.editingRoots || this.pathWriters || (id !== undefined && this.writes.has(id))) throw libraryBusyError();
    this.editingRoots = true;
    this.editingLibrary = id;
    return {
      [Symbol.dispose]: () => {
        this.editingRoots = false;
        this.editingLibrary = undefined;
      },
    };
  }

  beginPathLookup(): Disposable {
    if (this.editingRoots) throw libraryBusyError();
    this.pathWriters++;
    return {
      [Symbol.dispose]: () => {
        this.pathWriters--;
      },
    };
  }

  isReadOnly(id: number, stored: boolean | undefined): boolean {
    return !!stored || this.changing.has(id) || this.enabledSinceBoot.has(id);
  }

  keepFilesOnDelete(id: number, stored: boolean): boolean {
    if (this.changing.has(id)) throw libraryBusyError();
    return this.isReadOnly(id, stored);
  }

  assertWritable(id: number, stored: boolean | undefined): void {
    if (this.isReadOnly(id, stored)) throw readOnlyLibraryError();
  }

  beginWrite(id: number, stored: boolean | undefined): Disposable {
    this.assertWritable(id, stored);
    if (this.editingRoots && this.editingLibrary === id) throw libraryBusyError();
    this.writes.set(id, (this.writes.get(id) ?? 0) + 1);
    return {
      [Symbol.dispose]: () => {
        const remaining = this.writes.get(id)! - 1;
        if (remaining) this.writes.set(id, remaining);
        else this.writes.delete(id);
      },
    };
  }

  async change<T>(id: number, readOnly: boolean, save: () => Promise<T>): Promise<T> {
    if (this.writes.has(id) || this.changing.has(id)) {
      throw libraryBusyError();
    }
    this.changing.add(id);
    try {
      const result = await save();
      if (readOnly) this.enabledSinceBoot.add(id);
      else this.enabledSinceBoot.delete(id);
      return result;
    } finally {
      this.changing.delete(id);
    }
  }
}

export const libraryFilePolicy = new LibraryFilePolicy();
