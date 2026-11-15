import type { JobStatus } from '@bookorbit/types';

export type MetadataFetchQueueStatus = Extract<JobStatus, 'running' | 'queued' | 'paused'>;

/** The Jobs queue row's status: the pause flag first, then whether a book is being fetched. Null while nothing waits. */
export function metadataFetchQueueStatus(counts: { queued: number; processing: number }, paused: boolean): MetadataFetchQueueStatus | null {
  if (counts.queued + counts.processing === 0) return null;
  if (paused) return 'paused';
  return counts.processing > 0 ? 'running' : 'queued';
}
