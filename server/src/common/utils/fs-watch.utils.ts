import type { FSWatcher } from 'chokidar';

export type WatchEventType = 'delete' | 'create';

export function normalizeWatchEvent(eventName: string): WatchEventType | null {
  if (eventName === 'unlink' || eventName === 'unlinkDir') return 'delete';
  if (eventName === 'add' || eventName === 'addDir' || eventName === 'change') return 'create';
  return null;
}

export function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleReady = () => {
      watcher.off('error', handleError);
      resolve();
    };
    const handleError = (error: unknown) => {
      watcher.off('ready', handleReady);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    watcher.once('ready', handleReady);
    watcher.once('error', handleError);
  });
}
