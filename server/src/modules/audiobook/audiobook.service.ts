import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import { BadRequestException, ConflictException, Injectable, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import {
  AUDIOBOOK_MANIFEST_SCHEMA,
  AUDIOBOOK_MANIFEST_VERSION,
  isAudioFormat,
  type AudiobookBookmark,
  type AudiobookManifest,
  type AudiobookManifestAsset,
  type AudiobookManifestChapter,
  type AudiobookPlaybackState,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { naturalCompare } from '../../common/utils/natural-sort.utils';
import type { BookmarkRow } from '../../db/schema';
import { BookService } from '../book/book.service';
import type { CreateAudiobookBookmarkDto } from './dto/create-audiobook-bookmark.dto';
import type { PutAudiobookPlaybackStateDto } from './dto/put-audiobook-playback-state.dto';
import type { UpdateAudiobookBookmarkDto } from './dto/update-audiobook-bookmark.dto';
import { AudiobookRepository } from './audiobook.repository';

type AudioFileRow = Awaited<ReturnType<AudiobookRepository['findAudioFiles']>>[number];

interface ManifestContext {
  manifest: AudiobookManifest;
  files: AudioFileRow[];
  libraryId: number;
}

@Injectable()
export class AudiobookService {
  constructor(
    private readonly repo: AudiobookRepository,
    private readonly bookService: BookService,
  ) {}

  async getManifest(bookId: number, user: RequestUser): Promise<AudiobookManifest> {
    return (await this.loadManifestContext(bookId, user)).manifest;
  }

  async getAsset(bookId: number, assetId: string, user: RequestUser) {
    await this.bookService.verifyBookAccess(bookId, user);
    const row = await this.repo.findAsset(bookId, this.publicIdFromAssetId(assetId));
    if (!row || !row.format || !isAudioFormat(row.format)) throw new NotFoundException('Audiobook asset not found');
    const file = await this.bookService.getFileInfo(row.id, user);
    return {
      absolutePath: file.path,
      format: file.format,
      sizeBytes: file.size,
    };
  }

  async getPlaybackState(bookId: number, user: RequestUser): Promise<AudiobookPlaybackState | null> {
    const context = await this.loadManifestContext(bookId, user);
    const row = await this.repo.findPlaybackState(user.id, bookId);
    if (!row) return null;
    const file = context.files.find((candidate) => candidate.id === row.currentFileId);
    if (!file) return null;
    return {
      assetId: this.assetId(file.publicId),
      positionMs: Math.max(0, Math.round(row.positionSeconds * 1000)),
      percentage: row.percentage,
      completed: row.percentage >= 100,
      capturedAt: row.capturedAt.toISOString(),
      revision: row.revision,
      manifestRevision: row.manifestRevision ?? context.manifest.revision,
    };
  }

  async putPlaybackState(bookId: number, dto: PutAudiobookPlaybackStateDto, user: RequestUser): Promise<AudiobookPlaybackState> {
    const context = await this.loadManifestContext(bookId, user);
    if (dto.manifestRevision !== context.manifest.revision) {
      throw new PreconditionFailedException('Audiobook manifest has changed');
    }
    const fileIndex = context.files.findIndex((file) => this.assetId(file.publicId) === dto.assetId);
    if (fileIndex < 0) throw new BadRequestException('assetId does not belong to this audiobook');

    const previous = await this.repo.findPlaybackState(user.id, bookId);
    if (previous?.operationId === dto.operationId) {
      return (await this.getPlaybackState(bookId, user))!;
    }

    const asset = context.manifest.assets[fileIndex]!;
    if (asset.durationMs !== null && dto.positionMs > asset.durationMs) {
      throw new BadRequestException('positionMs exceeds the asset duration');
    }
    const elapsedBefore = context.manifest.assets.slice(0, fileIndex).reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
    const absolutePositionMs = elapsedBefore + dto.positionMs;
    const percentage =
      context.manifest.totalDurationMs > 0 ? Math.max(0, Math.min(100, (absolutePositionMs / context.manifest.totalDurationMs) * 100)) : 0;
    const values = {
      currentFileId: context.files[fileIndex]!.id,
      positionSeconds: dto.positionMs / 1000,
      percentage,
      capturedAt: new Date(dto.capturedAt),
      operationId: dto.operationId,
      manifestRevision: dto.manifestRevision,
    };
    const saved =
      dto.baseRevision === 0
        ? await this.repo.createPlaybackState(user.id, bookId, values)
        : await this.repo.updatePlaybackState(user.id, bookId, dto.baseRevision, values);
    if (!saved) throw new ConflictException('Playback state revision conflict');

    const strongRereadEvidence = previous !== null && previous.percentage - percentage >= 10;
    await this.bookService.autoUpdateReadStatusForProgress(
      user.id,
      { bookId, libraryId: context.libraryId },
      percentage,
      strongRereadEvidence ? { origin: 'bookorbit', strongRereadEvidence: true } : {},
    );
    return {
      assetId: dto.assetId,
      positionMs: dto.positionMs,
      percentage,
      completed: percentage >= 100,
      capturedAt: saved.capturedAt.toISOString(),
      revision: saved.revision,
      manifestRevision: dto.manifestRevision,
    };
  }

  async deletePlaybackState(bookId: number, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    await this.repo.deletePlaybackState(user.id, bookId);
  }

  async listBookmarks(bookId: number, user: RequestUser): Promise<AudiobookBookmark[]> {
    await this.bookService.verifyBookAccess(bookId, user);
    const rows = await this.repo.findAudioBookmarks(user.id, bookId);
    return rows.map((row) => this.mapBookmark(row));
  }

  async createBookmark(bookId: number, dto: CreateAudiobookBookmarkDto, user: RequestUser): Promise<AudiobookBookmark> {
    const context = await this.loadManifestContext(bookId, user);
    if (context.manifest.totalDurationMs > 0 && dto.positionMs > context.manifest.totalDurationMs) {
      throw new BadRequestException('positionMs exceeds the audiobook duration');
    }
    if (dto.chapterId && !context.manifest.chapters.some((chapter) => chapter.id === dto.chapterId)) {
      throw new BadRequestException('chapterId does not belong to this audiobook manifest');
    }
    const row = await this.repo.createAudioBookmark(user.id, bookId, {
      clientId: dto.clientId,
      positionSeconds: dto.positionMs / 1000,
      chapterId: dto.chapterId ?? null,
      title: dto.title,
      note: dto.note ?? null,
    });
    if (!row) throw new ConflictException('Audiobook bookmark already exists');
    return this.mapBookmark(row);
  }

  async updateBookmark(bookId: number, bookmarkId: string, dto: UpdateAudiobookBookmarkDto, user: RequestUser): Promise<AudiobookBookmark> {
    await this.bookService.verifyBookAccess(bookId, user);
    if (dto.title === undefined && dto.note === undefined) {
      throw new BadRequestException('At least one bookmark field is required');
    }
    const row = await this.repo.updateAudioBookmark(user.id, bookId, bookmarkId, dto);
    if (!row) throw new NotFoundException('Audiobook bookmark not found');
    return this.mapBookmark(row);
  }

  async deleteBookmark(bookId: number, bookmarkId: string, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    if (!(await this.repo.deleteAudioBookmark(user.id, bookId, bookmarkId))) {
      throw new NotFoundException('Audiobook bookmark not found');
    }
  }

  private async loadManifestContext(bookId: number, user: RequestUser): Promise<ManifestContext> {
    await this.bookService.verifyBookAccess(bookId, user);
    const [detail, rows] = await Promise.all([this.bookService.getDetail(bookId, user), this.repo.findAudioFiles(bookId)]);
    const files = rows
      .filter((row) => row.format !== null && isAudioFormat(row.format))
      .sort((left, right) => {
        if (left.sortOrder !== null || right.sortOrder !== null) {
          const byOrder = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
          if (byOrder !== 0) return byOrder;
        }
        return naturalCompare(basename(left.absolutePath), basename(right.absolutePath));
      });
    if (files.length === 0) throw new NotFoundException('Book has no audiobook assets');

    const revision = createHash('sha256')
      .update(
        JSON.stringify({
          files: files.map((file) => [file.publicId, file.sizeBytes, file.durationSeconds, file.mtime?.toISOString(), file.updatedAt.toISOString()]),
          chapters: detail.audioMetadata?.chapters ?? [],
        }),
      )
      .digest('hex');
    const assets = files.map<AudiobookManifestAsset>((file, sequence) => ({
      assetId: this.assetId(file.publicId),
      sequence,
      format: file.format!,
      durationMs: file.durationSeconds === null ? null : Math.round(file.durationSeconds * 1000),
      sizeBytes: file.sizeBytes,
      etag: createHash('sha256')
        .update(`${file.publicId}:${file.sizeBytes ?? ''}:${file.mtime?.getTime() ?? ''}`)
        .digest('hex'),
    }));
    const totalDurationMs =
      detail.audioMetadata?.durationSeconds !== null && detail.audioMetadata?.durationSeconds !== undefined
        ? Math.round(detail.audioMetadata.durationSeconds * 1000)
        : assets.reduce((sum, asset) => sum + (asset.durationMs ?? 0), 0);
    const chapters = this.buildChapters(bookId, revision, detail.audioMetadata?.chapters ?? [], assets, totalDurationMs);
    return {
      libraryId: detail.libraryId,
      files,
      manifest: {
        schema: AUDIOBOOK_MANIFEST_SCHEMA,
        schemaVersion: AUDIOBOOK_MANIFEST_VERSION,
        revision,
        book: {
          id: bookId,
          title: detail.title ?? basename(detail.folderPath),
          authors: detail.authors.map((author) => author.name),
          narrators: detail.audioMetadata?.narrators.map((narrator) => narrator.name) ?? [],
          hasCover: detail.coverSource !== null,
        },
        assets,
        chapters,
        totalDurationMs,
      },
    };
  }

  private buildChapters(
    bookId: number,
    revision: string,
    chapters: { title: string; startMs: number }[],
    assets: AudiobookManifestAsset[],
    totalDurationMs: number,
  ): AudiobookManifestChapter[] {
    return [...chapters]
      .sort((left, right) => left.startMs - right.startMs)
      .map((chapter, sequence, ordered) => {
        const startMs = Math.max(0, Math.round(chapter.startMs));
        const endMs = Math.max(startMs, Math.round(ordered[sequence + 1]?.startMs ?? totalDurationMs));
        let elapsed = 0;
        let assetIndex = 0;
        for (let index = 0; index < assets.length; index += 1) {
          const duration = assets[index]!.durationMs ?? 0;
          if (index === assets.length - 1 || startMs < elapsed + duration) {
            assetIndex = index;
            break;
          }
          elapsed += duration;
        }
        return {
          id: `ch_${createHash('sha256').update(`${bookId}:${revision}:${sequence}:${startMs}`).digest('hex').slice(0, 32)}`,
          title: chapter.title,
          assetId: assets[assetIndex]!.assetId,
          sequence,
          startMs,
          endMs,
          assetOffsetMs: Math.max(0, startMs - elapsed),
        };
      });
  }

  private mapBookmark(row: BookmarkRow): AudiobookBookmark {
    return {
      id: row.clientId,
      bookId: row.bookId,
      positionMs: Math.max(0, Math.round((row.positionSeconds ?? 0) * 1000)),
      chapterId: row.chapterId,
      title: row.title,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private assetId(publicId: string): string {
    return `aud_${publicId}`;
  }

  private publicIdFromAssetId(assetId: string): string {
    const publicId = assetId.startsWith('aud_') ? assetId.slice(4) : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId)) {
      throw new NotFoundException('Audiobook asset not found');
    }
    return publicId;
  }
}
