import { Injectable } from '@nestjs/common';

import { LibraryDockRepository, type LibraryDockWithLibrary } from './library-dock.repository';

/**
 * Every library dock, held in memory so the watcher can map a path to its dock without a query per
 * file event. Docks change only through management actions, which call `refresh()`; a library
 * deleted elsewhere takes its dock with it and refreshes this too.
 */
@Injectable()
export class LibraryDockRegistry {
  private loading: Promise<void> | null = null;
  private byFolder = new Map<string, LibraryDockWithLibrary>();
  private byId = new Map<number, LibraryDockWithLibrary>();

  constructor(private readonly repo: LibraryDockRepository) {}

  async refresh(): Promise<void> {
    this.loading = this.load();
    await this.loading;
  }

  /** The dock that owns this folder name, enabled or not. Folder names compare ignoring case. */
  async findByFolderName(folderName: string): Promise<LibraryDockWithLibrary | undefined> {
    await this.ensureLoaded();
    return this.byFolder.get(folderKey(folderName));
  }

  /** The dock that owns this folder name, only when it is turned on. */
  async findEnabledByFolderName(folderName: string): Promise<LibraryDockWithLibrary | undefined> {
    const dock = await this.findByFolderName(folderName);
    return dock?.enabled ? dock : undefined;
  }

  /** Every dock, enabled or not. One per library at most, so this is small. */
  async all(): Promise<LibraryDockWithLibrary[]> {
    await this.ensureLoaded();
    return [...this.byId.values()];
  }

  async findById(id: number): Promise<LibraryDockWithLibrary | undefined> {
    await this.ensureLoaded();
    return this.byId.get(id);
  }

  private ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      const rows = await this.repo.listAll();
      this.byFolder = new Map(rows.map((row) => [folderKey(row.folderName), row]));
      this.byId = new Map(rows.map((row) => [row.id, row]));
    } catch (err) {
      // A failed load is retried on the next lookup rather than remembered.
      this.loading = null;
      throw err;
    }
  }
}

function folderKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}
