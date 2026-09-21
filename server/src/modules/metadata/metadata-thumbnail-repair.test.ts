import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

import { DB } from '../../db';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { NarratorService } from '../narrator/narrator.service';
import { ComicMetadataRepository } from './comic-metadata.repository';
import { MetadataExtractionService } from './metadata-extraction.service';
import { MetadataService } from './metadata.service';

describe('MetadataService thumbnail repair', () => {
  let appDataPath: string;
  let service: MetadataService;

  async function makeCover(): Promise<Buffer> {
    return sharp({ create: { width: 800, height: 1200, channels: 3, background: '#336699' } })
      .jpeg()
      .toBuffer();
  }

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-thumbnail-repair-'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        MetadataService,
        { provide: DB, useValue: {} },
        { provide: ConfigService, useValue: { get: () => appDataPath } },
        { provide: MetadataExtractionService, useValue: {} },
        { provide: MetadataScoreService, useValue: { calculateAndSave: vi.fn() } },
        { provide: NarratorService, useValue: {} },
        { provide: ComicMetadataRepository, useValue: {} },
        { provide: BookMetadataLockService, useValue: { isFieldLocked: vi.fn().mockResolvedValue(false) } },
        { provide: BookEmbedderService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(MetadataService);
  });

  afterEach(async () => {
    await rm(appDataPath, { recursive: true, force: true });
  });

  async function seedCoverDir(bookId: number, coverFileName: string, bytes: Buffer): Promise<string> {
    const coverDir = join(appDataPath, 'covers', String(bookId));
    await mkdir(coverDir, { recursive: true });
    await writeFile(join(coverDir, coverFileName), bytes);
    return coverDir;
  }

  it('reproduces and repairs a missing thumbnail beside an intact custom cover', async () => {
    const coverDir = await seedCoverDir(913, 'cover_custom.jpg', await makeCover());
    const thumbnailPath = join(coverDir, 'thumbnail.jpg');

    await expect(access(thumbnailPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(service.ensureThumbnailForBook(913)).resolves.toBe(thumbnailPath);

    const metadata = await sharp(await readFile(thumbnailPath)).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 400, height: 600 });
  });

  it('repairs from a legacy cover file the cover endpoint still serves', async () => {
    const coverDir = await seedCoverDir(914, 'cover.jpg', await makeCover());

    await expect(service.ensureThumbnailForBook(914)).resolves.toBe(join(coverDir, 'thumbnail.jpg'));
  });

  it('leaves no temporary file behind once the thumbnail is published', async () => {
    const coverDir = await seedCoverDir(915, 'cover_extracted.jpg', await makeCover());

    await service.ensureThumbnailForBook(915);

    await expect(readdir(coverDir)).resolves.toEqual(expect.arrayContaining(['cover_extracted.jpg', 'thumbnail.jpg']));
    await expect(readdir(coverDir)).resolves.toHaveLength(2);
  });

  it('keeps a thumbnail written while the repair was in flight', async () => {
    const coverDir = await seedCoverDir(916, 'cover_custom.jpg', await makeCover());
    const thumbnailPath = join(coverDir, 'thumbnail.jpg');
    const existing = Buffer.from('thumbnail written by a concurrent cover update');

    const repair = service.ensureThumbnailForBook(916);
    await writeFile(thumbnailPath, existing);

    await expect(repair).resolves.toBe(thumbnailPath);
    await expect(readFile(thumbnailPath)).resolves.toEqual(existing);
  });

  it('resolves null instead of throwing when the cover cannot be decoded', async () => {
    await seedCoverDir(917, 'cover_custom.jpg', Buffer.alloc(0));

    await expect(service.ensureThumbnailForBook(917)).resolves.toBeNull();
  });

  it('resolves null when the book has no cover directory at all', async () => {
    await expect(service.ensureThumbnailForBook(918)).resolves.toBeNull();
  });
});
