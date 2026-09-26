import { Injectable, Logger } from '@nestjs/common';
import { readFile, rename, unlink, writeFile } from 'fs/promises';
import { join, relative, sep } from 'path';

import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PodcastEpisodeRepository } from './podcast-episode.repository';

export const METADATA_SIDECAR_NAME = 'metadata.json';
const EPISODE_PAGE_SIZE = 500;
/** Enough to hold a large show's episode list without letting a hand-edited file grow unbounded. */
const MAX_SIDECAR_BYTES = 8 * 1024 * 1024;

interface SidecarShow {
  title: string;
  author: string | null;
  description: string | null;
}

interface SidecarEpisode {
  path: string;
  title: string;
  description?: string;
  publishedAt?: string;
  season?: string;
  episode?: string;
  durationSeconds?: number;
}

/**
 * Writes what BookOrbit knows about a local show back into its folder as an Audiobookshelf-shaped
 * `metadata.json`, the same file the importer already reads.
 *
 * Only sidecars are written, never the audio files: a local episode's identity is a hash of its own
 * bytes, so retagging a file would make the next discovery pass see a different episode and orphan
 * the play state, bookmarks, and queue entries attached to the old one.
 *
 * Fields the file already carries that BookOrbit does not own are preserved, because these folders
 * belong to the user and may hold keys written by whatever tool put them there.
 */
@Injectable()
export class PodcastSidecarService {
  private readonly logger = new Logger(PodcastSidecarService.name);

  constructor(
    private readonly episodes: PodcastEpisodeRepository,
    private readonly selfWrites: SelfWriteRegistry,
  ) {}

  /**
   * Rewrites one show's sidecar. Never throws: a read-only mount or a folder that vanished mid-run
   * costs the sidecar, not the import that produced the episodes.
   */
  async writeShowSidecar(podcastId: number, folderPath: string, show: SidecarShow): Promise<boolean> {
    const event = 'podcast.sidecar_write';
    const startedAt = Date.now();
    const target = join(folderPath, METADATA_SIDECAR_NAME);
    try {
      const existing = await this.readExisting(target);
      const episodes = await this.collectEpisodes(podcastId, folderPath);
      const merged = {
        ...existing,
        title: show.title,
        author: show.author ?? undefined,
        description: show.description ?? undefined,
        episodes,
      };
      const body = `${JSON.stringify(merged, null, 2)}\n`;
      if (Buffer.byteLength(body) > MAX_SIDECAR_BYTES) {
        this.logger.warn(
          `[${event}] [fail] podcastId=${podcastId} path="${sanitizeLogValue(target)}" - sidecar exceeds the size limit and was not written`,
        );
        return false;
      }
      await this.selfWrites.track([target], () => this.writeAtomically(target, body));
      this.logger.log(
        `[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} episodes=${episodes.length} path="${sanitizeLogValue(target)}" - show sidecar written`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `[${event}] [fail] podcastId=${podcastId} durationMs=${Date.now() - startedAt} path="${sanitizeLogValue(target)}" errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - show sidecar could not be written`,
      );
      return false;
    }
  }

  /** Whatever the folder already holds, so keys BookOrbit does not own survive the rewrite. */
  private async readExisting(target: string): Promise<Record<string, unknown>> {
    const raw = await readFile(target, 'utf8').catch(() => null);
    if (!raw || raw.length > MAX_SIDECAR_BYTES) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private async collectEpisodes(podcastId: number, folderPath: string): Promise<SidecarEpisode[]> {
    const episodes: SidecarEpisode[] = [];
    let afterEpisodeId = 0;
    for (;;) {
      const rows = await this.episodes.listLocalEpisodesForSidecar(podcastId, afterEpisodeId, EPISODE_PAGE_SIZE);
      if (rows.length === 0) break;
      for (const row of rows) {
        afterEpisodeId = row.episodeId;
        // The file is the key, written relative to the folder so subfolders survive a move of the
        // whole show and so nothing in the file discloses where the library sits on disk.
        const path = row.localPath ? toPosixRelative(folderPath, row.localPath) : null;
        if (!path) continue;
        episodes.push({
          path,
          title: row.title,
          ...(row.description ? { description: row.description } : {}),
          ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
          ...(row.season ? { season: row.season } : {}),
          ...(row.episode ? { episode: row.episode } : {}),
          ...(row.durationSeconds !== null ? { durationSeconds: row.durationSeconds } : {}),
        });
      }
      if (rows.length < EPISODE_PAGE_SIZE) break;
    }
    return episodes.sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Temp file then rename, so a reader never sees a half-written sidecar. */
  private async writeAtomically(target: string, body: string): Promise<void> {
    const temporary = `${target}.bookorbit.tmp`;
    try {
      await writeFile(temporary, body, 'utf8');
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

/** A path inside the show folder, in the one separator style a sidecar should be portable across. */
function toPosixRelative(folderPath: string, filePath: string): string | null {
  const relativePath = relative(folderPath, filePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith('../')) return null;
  return relativePath.split(sep).join('/');
}
