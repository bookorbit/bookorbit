import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

/** Runs once the change it was prepared for has been made. */
export type LibraryLifecycleFollowUp = () => Promise<void>;

/**
 * What a module that keeps its own state about libraries needs to hear, without the library module
 * depending on it. A module registers itself when it starts.
 */
export interface LibraryLifecycleListener {
  /** Throws an HTTP exception when a folder about to be added to a library may not be used. Paths are canonical. */
  assertFolderPathsAllowed?(paths: string[]): Promise<void>;
  /** Called before a library is deleted. The follow-up runs only once the delete succeeded. */
  prepareLibraryDelete?(library: { id: number; name: string }): Promise<LibraryLifecycleFollowUp | void>;
  /** Called before folders are removed from a library. The follow-up runs once they are gone. */
  prepareFoldersRemove?(libraryId: number, folderIds: number[]): Promise<LibraryLifecycleFollowUp | void>;
}

@Injectable()
export class LibraryLifecycleService {
  private readonly logger = new Logger(LibraryLifecycleService.name);
  private readonly listeners: LibraryLifecycleListener[] = [];

  register(listener: LibraryLifecycleListener): void {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  async assertFolderPathsAllowed(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    for (const listener of this.listeners) await listener.assertFolderPathsAllowed?.(paths);
  }

  async prepareLibraryDelete(library: { id: number; name: string }): Promise<LibraryLifecycleFollowUp> {
    const followUps: LibraryLifecycleFollowUp[] = [];
    for (const listener of this.listeners) {
      const followUp = await listener.prepareLibraryDelete?.(library);
      if (followUp) followUps.push(followUp);
    }
    return () => this.runFollowUps('library.delete_follow_up', `libraryId=${library.id}`, followUps);
  }

  async prepareFoldersRemove(libraryId: number, folderIds: number[]): Promise<LibraryLifecycleFollowUp> {
    const followUps: LibraryLifecycleFollowUp[] = [];
    if (folderIds.length > 0) {
      for (const listener of this.listeners) {
        const followUp = await listener.prepareFoldersRemove?.(libraryId, folderIds);
        if (followUp) followUps.push(followUp);
      }
    }
    return () => this.runFollowUps('library.folders_remove_follow_up', `libraryId=${libraryId} folders=${folderIds.length}`, followUps);
  }

  /** The change itself has already been made, so a listener that fails here is logged rather than undoing it. */
  private async runFollowUps(event: string, keys: string, followUps: LibraryLifecycleFollowUp[]): Promise<void> {
    for (const followUp of followUps) {
      try {
        await followUp();
      } catch (err) {
        this.logger.warn(
          `[${event}] [fail] ${keys} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - listener follow-up failed`,
        );
      }
    }
  }
}
