import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { gunzip, gzip } from 'zlib';

import { podcastFeedSnapshotDirPath, podcastFeedSnapshotPath } from '../../common/podcast-feed-snapshot-storage';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

const compress = promisify(gzip);
const decompress = promisify(gunzip);

/**
 * The last feed body a refresh parsed successfully, kept so a parser change can be applied to a feed
 * that has not changed since. Latest-only: each successful refresh overwrites the previous copy.
 */
@Injectable()
export class PodcastFeedSnapshotService {
  private readonly logger = new Logger(PodcastFeedSnapshotService.name);
  private readonly appDataPath: string;

  constructor(appConfig: ConfigService) {
    this.appDataPath = appConfig.getOrThrow<string>('storage.appDataPath');
  }

  /**
   * Returns the write time on success. A failure here is reported rather than thrown: losing the
   * stored copy is a diagnostics regression, not a reason to fail a refresh that already succeeded.
   */
  async write(podcastId: number, xml: string): Promise<Date | null> {
    const event = 'podcast.write_feed_snapshot';
    const startedAt = Date.now();
    const directory = podcastFeedSnapshotDirPath(this.appDataPath);
    const target = podcastFeedSnapshotPath(this.appDataPath, podcastId);
    const temporaryPath = join(directory, `.${podcastId}-${randomUUID()}.xml.gz.tmp`);
    try {
      const compressed = await compress(Buffer.from(xml, 'utf-8'));
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, compressed);
      await rename(temporaryPath, target);
      this.logger.log(
        `[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} bytes=${compressed.byteLength} - feed snapshot stored`,
      );
      return new Date();
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      this.logger.warn(
        `[${event}] [fail] podcastId=${podcastId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - feed snapshot write failed`,
      );
      return null;
    }
  }

  async read(podcastId: number): Promise<string | null> {
    try {
      return (await decompress(await readFile(podcastFeedSnapshotPath(this.appDataPath, podcastId)))).toString('utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(podcastId: number): Promise<void> {
    await rm(podcastFeedSnapshotPath(this.appDataPath, podcastId), { force: true });
  }
}
