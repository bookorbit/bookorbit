import { stat } from 'fs/promises';

import { buildEpubMediaOverlayPlaylistFromFile } from './epub-media-overlay';
import { buildAudioTimeline } from './epub-media-overlay-timeline';

const CACHE_MAX = 64;

type CacheEntry = { mtimeMs: number; size: number; seconds: Promise<number | null> };

const cache = new Map<string, CacheEntry>();

/**
 * The length of the audio timeline a read-along EPUB carries. Reading it opens every media
 * overlay document of the book, so the answer is kept per file until the file changes.
 */
export async function readEpubAudioTimelineSeconds(absolutePath: string): Promise<number | null> {
  const { mtimeMs, size } = await stat(absolutePath);
  const cached = cache.get(absolutePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    cache.delete(absolutePath);
    cache.set(absolutePath, cached);
    return cached.seconds;
  }

  const seconds = buildEpubMediaOverlayPlaylistFromFile(absolutePath, 0, null).then(
    (playlist) => buildAudioTimeline(playlist.items)?.totalSeconds ?? null,
  );
  cache.delete(absolutePath);
  cache.set(absolutePath, { mtimeMs, size, seconds });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  try {
    return await seconds;
  } catch (error) {
    if (cache.get(absolutePath)?.seconds === seconds) cache.delete(absolutePath);
    throw error;
  }
}
