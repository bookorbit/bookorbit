import { createHash } from 'crypto';
import { mkdir, mkdtemp, open, opendir, rename, rm, stat, writeFile, readFile, lstat, realpath } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { isAbsolute, join, relative, sep } from 'path';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as unzipper from 'unzipper';
import type { DeliveryArtifactMetadata, ReadAloudDeliveryPreference } from '@bookorbit/types';
import { audiolessEpubConfig, storageConfig } from '../../config/config';
import { computeFileHashFromHandle } from '../../common/utils/file-hash.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AudiolessEpubService } from './audioless-epub.service';
import { FileLockService } from '../file-write/file-lock.service';
import { DeliveryArtifactRepository } from './delivery-artifact.repository';
import { inspectDeliveryEpub } from './epub-delivery-validation';

const DELIVERY_DETECTOR_VERSION = 'overlay-inspection-v2';
export const DELIVERY_TRANSFORM_VERSION = 'text-only-v2';
export interface DeliverySource {
  id: number;
  absolutePath: string;
  format: string | null;
  mediaOverlayAvailable?: boolean;
  mtime?: Date | null;
  sizeBytes?: number | null;
  ino?: bigint;
}
export interface DeliveryArtifact extends DeliveryArtifactMetadata {
  path: string;
  release: () => Promise<void>;
}

async function digestHandle(handle: FileHandle): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) digest.update(chunk);
  return digest.digest('hex');
}
export const deliveryFileSignature = (value: Awaited<ReturnType<FileHandle['stat']>>) =>
  `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;

@Injectable()
export class DeliveryArtifactService {
  private readonly logger = new Logger(DeliveryArtifactService.name);
  private readonly root: string;
  private readonly appRoot: string;
  private readonly builds = new Map<string, Promise<Omit<DeliveryArtifact, 'release'>>>();
  private readonly leased = new Map<string, number>();
  private publication: Promise<void> = Promise.resolve();
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    @Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>,
    @Inject(audiolessEpubConfig.KEY) private readonly limits: ConfigType<typeof audiolessEpubConfig>,
    private readonly stripper: AudiolessEpubService,
    private readonly repository: DeliveryArtifactRepository,
    private readonly locks: FileLockService,
  ) {
    this.appRoot = storage.appDataPath;
    this.root = join(storage.appDataPath, '.delivery-cache');
  }

  async prepare(
    source: DeliverySource,
    requestedVariant: ReadAloudDeliveryPreference,
    expectedRevision?: string,
    signal?: AbortSignal,
  ): Promise<DeliveryArtifact> {
    if (this.active >= this.limits.maxConcurrentBuilds) {
      if (this.waiting.length >= 64) throw new BadRequestException({ code: 'DELIVERY_BUSY' });
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          const index = this.waiting.indexOf(grant);
          if (index >= 0) this.waiting.splice(index, 1);
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          reject(new BadRequestException({ code: 'DELIVERY_CANCELLED_OR_TIMED_OUT' }));
        };
        const grant = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          resolve();
        };
        const timer = setTimeout(cancel, 60_000);
        this.waiting.push(grant);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    } else {
      this.active++;
    }
    try {
      return await this.locks.withLock(source.absolutePath, async () => {
        let handle: FileHandle | undefined;
        try {
          if (signal?.aborted) throw new BadRequestException({ code: 'DELIVERY_CANCELLED_OR_TIMED_OUT' });
          const root = await this.repository.findSourceRoot(source.id);
          if (!root) throw new ConflictException({ code: 'DELIVERY_SOURCE_UNAVAILABLE' });
          const resolvedSource = await realpath(source.absolutePath);
          const relativeSource = relative(await realpath(root), resolvedSource);
          if (!relativeSource || relativeSource === '..' || relativeSource.startsWith(`..${sep}`) || isAbsolute(relativeSource))
            throw new ForbiddenException({ code: 'DELIVERY_SOURCE_OUTSIDE_LIBRARY' });
          handle = await open(resolvedSource, 'r');
          const before = await handle.stat();
          if (
            source.mtime &&
            (Math.floor(before.mtimeMs) !== source.mtime.getTime() ||
              (source.sizeBytes !== undefined && source.sizeBytes !== null && source.sizeBytes !== before.size) ||
              (source.ino !== undefined && source.ino !== (await handle.stat({ bigint: true })).ino))
          )
            throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
          const sourceRevision = await digestHandle(handle);
          if (
            deliveryFileSignature(before) !== deliveryFileSignature(await handle.stat()) ||
            deliveryFileSignature(before) !== deliveryFileSignature(await stat(source.absolutePath))
          ) {
            throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
          }
          if (expectedRevision && sourceRevision !== expectedRevision) throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
          const format = source.format?.toLowerCase() ?? 'unknown';
          const transform =
            format === 'epub' && requestedVariant !== 'original' && (requestedVariant === 'audioless_epub' || source.mediaOverlayAvailable);
          if (!transform) {
            const fileHash = await computeFileHashFromHandle(handle);
            if (deliveryFileSignature(before) !== deliveryFileSignature(await handle.stat()))
              throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
            return {
              artifactId: sourceRevision,
              sourceRevision,
              requestedVariant,
              actualVariant: 'original',
              format,
              sizeBytes: before.size,
              sha256: sourceRevision,
              fileHash,
              outcome: 'original',
              path: source.absolutePath,
              release: () => Promise.resolve(),
            };
          }
          const key = createHash('sha256')
            .update(`${source.id}:${sourceRevision}:${DELIVERY_TRANSFORM_VERSION}:${requestedVariant ?? 'inherited'}`)
            .digest('hex');
          let pending = this.builds.get(key);
          if (!pending) {
            pending = this.build(source, sourceRevision, requestedVariant, key);
            this.builds.set(key, pending);
          }
          let artifact: Omit<DeliveryArtifact, 'release'>;
          try {
            artifact = await pending;
          } finally {
            if (this.builds.get(key) === pending) this.builds.delete(key);
          }
          this.leased.set(key, (this.leased.get(key) ?? 0) + 1);
          let released = false;
          return {
            ...artifact,
            release: () => {
              if (released) return Promise.resolve();
              released = true;
              const count = (this.leased.get(key) ?? 1) - 1;
              if (count) this.leased.set(key, count);
              else this.leased.delete(key);
              return Promise.resolve();
            },
          };
        } finally {
          await handle?.close();
        }
      });
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async build(
    source: DeliverySource,
    sourceRevision: string,
    requestedVariant: ReadAloudDeliveryPreference,
    key: string,
  ): Promise<Omit<DeliveryArtifact, 'release'>> {
    const startedAt = Date.now();
    await mkdir(this.root, { recursive: true });
    if ((await lstat(this.root)).isSymbolicLink() || (await realpath(this.root)) !== join(await realpath(this.appRoot), '.delivery-cache'))
      throw new ConflictException({ code: 'DELIVERY_CACHE_UNSAFE' });
    const directory = join(this.root, key);
    try {
      const path = join(directory, 'book.epub');
      if ((await lstat(directory)).isSymbolicLink() || (await lstat(path)).isSymbolicLink()) throw new ConflictException();
      const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) as Omit<DeliveryArtifact, 'release'>;
      if (metadata.artifactId !== key || metadata.sourceRevision !== sourceRevision || metadata.requestedVariant !== requestedVariant)
        throw new ConflictException();
      const cached = await open(path, 'r');
      try {
        if ((await cached.stat()).size === metadata.sizeBytes && (await digestHandle(cached)) === metadata.sha256) return { ...metadata, path };
      } finally {
        await cached.close();
      }
      await rm(directory, { recursive: true, force: true });
    } catch {
      if (this.leased.has(key)) throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
      await rm(directory, { recursive: true, force: true });
    }
    const temporary = await mkdtemp(join(this.root, '.build-'));
    try {
      const narrated = await this.inspect(source, sourceRevision);
      const path = join(temporary, 'book.epub');
      if (!narrated) {
        const original = await this.prepareOriginal(source, sourceRevision, requestedVariant, 'verified_plain');
        return original;
      }
      await this.stripper.writeArchive(source.absolutePath, path);
      if (await inspectDeliveryEpub(await unzipper.Open.file(path), this.limits.maxSourceEntries, this.limits.maxMetadataBytes)) {
        throw new BadRequestException({ code: 'UNSUPPORTED_TEXT_ONLY_EPUB', message: 'Narration remains in derivative' });
      }
      const handle = await open(path, 'r');
      let metadata: Omit<DeliveryArtifact, 'release'>;
      try {
        metadata = {
          artifactId: key,
          sourceRevision,
          requestedVariant,
          actualVariant: 'audioless_epub',
          format: 'epub',
          sizeBytes: (await handle.stat()).size,
          sha256: await digestHandle(handle),
          fileHash: await computeFileHashFromHandle(handle),
          outcome: 'stripped',
          path: '',
        };
      } finally {
        await handle.close();
      }
      await this.assertSourceRevision(source, sourceRevision);
      await writeFile(join(temporary, 'metadata.json'), JSON.stringify(metadata));
      const publish = this.publication.then(async () => {
        await this.evict(metadata.sizeBytes);
        try {
          await rename(temporary, directory);
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        }
      });
      this.publication = publish.catch(() => {});
      await publish;
      return { ...metadata, path: join(directory, 'book.epub') };
    } catch (error) {
      if (requestedVariant !== null || error instanceof ConflictException) throw error;
      this.logger.warn(
        `[delivery.prepare] [fail] fileId=${source.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - inherited delivery uses original fallback`,
      );
      return this.prepareOriginal(source, sourceRevision, requestedVariant, 'legacy_fallback');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async inspect(source: DeliverySource, sourceRevision: string): Promise<boolean> {
    const cached = await this.repository.findInspection(source.id);
    if (cached?.sourceRevision === sourceRevision && cached.detectorVersion === DELIVERY_DETECTOR_VERSION) {
      if (cached.state === 'verified_absent') return false;
      if (cached.state === 'verified_present') return true;
      if (cached.retryAt && cached.retryAt > new Date()) throw new BadRequestException({ code: 'DELIVERY_INSPECTION_FAILED' });
    }
    try {
      const present = await inspectDeliveryEpub(
        await unzipper.Open.file(source.absolutePath),
        this.limits.maxSourceEntries,
        this.limits.maxMetadataBytes,
      );
      await this.assertSourceRevision(source, sourceRevision);
      await this.repository.saveInspection({
        bookFileId: source.id,
        sourceRevision,
        detectorVersion: DELIVERY_DETECTOR_VERSION,
        state: present ? 'verified_present' : 'verified_absent',
        retryAt: null,
      });
      return present;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      await this.repository.saveInspection({
        bookFileId: source.id,
        sourceRevision,
        detectorVersion: DELIVERY_DETECTOR_VERSION,
        state: 'failed',
        retryAt: new Date(Date.now() + 5 * 60_000),
      });
      throw error;
    }
  }

  private async assertSourceRevision(source: DeliverySource, revision: string): Promise<void> {
    const handle = await open(source.absolutePath, 'r');
    try {
      if ((await digestHandle(handle)) !== revision) throw new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' });
    } finally {
      await handle.close();
    }
  }

  private async prepareOriginal(
    source: DeliverySource,
    revision: string,
    requestedVariant: ReadAloudDeliveryPreference,
    outcome: DeliveryArtifactMetadata['outcome'],
  ): Promise<Omit<DeliveryArtifact, 'release'>> {
    await this.assertSourceRevision(source, revision);
    const handle = await open(source.absolutePath, 'r');
    try {
      return {
        artifactId: revision,
        sourceRevision: revision,
        requestedVariant,
        actualVariant: 'original',
        format: source.format ?? 'epub',
        sizeBytes: (await handle.stat()).size,
        sha256: revision,
        fileHash: await computeFileHashFromHandle(handle),
        outcome,
        path: source.absolutePath,
      };
    } finally {
      await handle.close();
    }
  }

  private async evict(requiredBytes: number): Promise<void> {
    const budget = this.limits.maxOutputBytes * 4;
    const records = await opendir(this.root);
    let total = requiredBytes;
    let count = 1;
    const candidates: { key: string; size: number; mtime: number }[] = [];
    for await (const entry of records) {
      if (entry.isDirectory() && entry.name.startsWith('.build-')) {
        const info = await stat(join(this.root, entry.name));
        if (Date.now() - info.mtimeMs > 20 * 60_000) await rm(join(this.root, entry.name), { recursive: true, force: true });
        continue;
      }
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      try {
        const info = await stat(join(this.root, entry.name, 'book.epub'));
        total += info.size;
        count++;
        candidates.push({ key: entry.name, size: info.size, mtime: info.mtimeMs });
        if (candidates.length > 1000) {
          candidates.sort((a, b) => a.mtime - b.mtime);
          candidates.pop();
        }
      } catch {
        /* incomplete entry */
      }
    }
    for (const entry of candidates.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= budget && count <= 1000) return;
      if (this.leased.has(entry.key) || this.builds.has(entry.key)) continue;
      await rm(join(this.root, entry.key), { recursive: true, force: true });
      total -= entry.size;
      count--;
    }
    if (total > budget || count > 1000) throw new BadRequestException({ code: 'DELIVERY_CACHE_FULL' });
  }
}
