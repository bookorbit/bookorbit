import { join } from 'path';

export const PODCAST_FEED_SNAPSHOT_DIR_NAME = 'podcast-feeds';

export function podcastFeedSnapshotDirPath(appDataPath: string): string {
  return join(appDataPath, PODCAST_FEED_SNAPSHOT_DIR_NAME);
}

export function podcastFeedSnapshotPath(appDataPath: string, podcastId: number): string {
  return join(podcastFeedSnapshotDirPath(appDataPath), `${podcastId}.xml.gz`);
}
