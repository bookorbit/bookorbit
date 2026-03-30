export {
  assertNoIntegrityViolations,
  closeE2EContext as closeScannerE2EContext,
  createE2EContext as createScannerE2EContext,
  loadLibraryBookState,
  seedLibrary,
  triggerAndWaitForLibraryScan,
  triggerLibraryScan,
  waitForCondition,
  waitForScanCompletion,
  type E2EContext as ScannerE2EContext,
  type LibraryBookState,
  type SeedLibraryInput,
} from '../app-harness';

import { FileWatcherService } from '../../../src/modules/scanner/file-watcher.service';
import type { E2EContext } from '../app-harness';

export async function startLibraryWatcher(ctx: E2EContext, libraryId: number, paths: string[]): Promise<void> {
  const watcher = ctx.app.get(FileWatcherService);
  await watcher.startWatcher(libraryId, paths);
}

export async function stopLibraryWatcher(ctx: E2EContext, libraryId: number): Promise<void> {
  const watcher = ctx.app.get(FileWatcherService);
  await watcher.stopWatcher(libraryId);
}
