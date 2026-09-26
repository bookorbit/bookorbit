import { join } from 'path';

export const PODCAST_ARTWORK_CUSTOM_FILE_PREFIX = 'artwork_custom.';
export const PODCAST_ARTWORK_THUMBNAIL_FILE_NAME = 'thumbnail.jpg';

export function podcastArtworkDirPath(appDataPath: string, podcastId: number): string {
  return join(appDataPath, 'podcast-artwork', String(podcastId));
}

export function podcastArtworkThumbnailPath(appDataPath: string, podcastId: number): string {
  return join(podcastArtworkDirPath(appDataPath, podcastId), PODCAST_ARTWORK_THUMBNAIL_FILE_NAME);
}

export function podcastArtworkFileName(extension: string): string {
  return `${PODCAST_ARTWORK_CUSTOM_FILE_PREFIX}${extension}`;
}

export function isCustomPodcastArtworkFileName(fileName: string): boolean {
  return fileName.startsWith(PODCAST_ARTWORK_CUSTOM_FILE_PREFIX);
}

export function findCustomPodcastArtworkFileName(files: readonly string[]): string | null {
  return files.find(isCustomPodcastArtworkFileName) ?? null;
}
