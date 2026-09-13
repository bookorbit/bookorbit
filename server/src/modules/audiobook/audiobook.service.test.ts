import { BadRequestException, ConflictException, PreconditionFailedException } from '@nestjs/common';
import { AUDIOBOOK_MANIFEST_SCHEMA, AUDIOBOOK_MANIFEST_VERSION } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AudiobookService } from './audiobook.service';

const FIRST_PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_PUBLIC_ID = '22222222-2222-4222-8222-222222222222';

function makeUser(): RequestUser {
  return {
    id: 7,
    username: 'listener',
    name: 'Listener',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    isSuperuser: false,
    permissions: [],
    contentFilters: null,
  };
}

function makeFixture() {
  const files = [
    {
      id: 12,
      publicId: SECOND_PUBLIC_ID,
      absolutePath: '/library/Part 2.mp3',
      format: 'mp3',
      sizeBytes: 2_000,
      durationSeconds: 20,
      sortOrder: 2,
      mtime: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    {
      id: 11,
      publicId: FIRST_PUBLIC_ID,
      absolutePath: '/library/Part 1.mp3',
      format: 'mp3',
      sizeBytes: 1_000,
      durationSeconds: 10.125,
      sortOrder: 1,
      mtime: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  const repo = {
    findAudioFiles: vi.fn().mockResolvedValue(files),
    findAsset: vi.fn(),
    findPlaybackState: vi.fn().mockResolvedValue(null),
    createPlaybackState: vi.fn(),
    updatePlaybackState: vi.fn(),
    deletePlaybackState: vi.fn(),
    findAudioBookmarks: vi.fn(),
    createAudioBookmark: vi.fn(),
    updateAudioBookmark: vi.fn(),
    deleteAudioBookmark: vi.fn(),
  };
  const bookService = {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    getFileInfo: vi.fn(),
    getDetail: vi.fn().mockResolvedValue({
      id: 30,
      libraryId: 4,
      title: 'A Long Listen',
      folderPath: '/library/A Long Listen',
      authors: [{ name: 'Author' }],
      coverSource: 'embedded',
      audioMetadata: {
        durationSeconds: 30.125,
        narrators: [{ name: 'Narrator' }],
        chapters: [
          { title: 'Opening', startMs: 0 },
          { title: 'Second Part', startMs: 10_125 },
        ],
      },
    }),
    autoUpdateReadStatusForProgress: vi.fn().mockResolvedValue(undefined),
  };
  return {
    repo,
    bookService,
    service: new AudiobookService(repo as never, bookService as never),
  };
}

describe('AudiobookService', () => {
  it('builds a versioned manifest with stable opaque assets and full chapter ranges', async () => {
    const { service, bookService } = makeFixture();

    const manifest = await service.getManifest(30, makeUser());

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(30, expect.objectContaining({ id: 7 }));
    expect(manifest.schema).toBe(AUDIOBOOK_MANIFEST_SCHEMA);
    expect(manifest.schemaVersion).toBe(AUDIOBOOK_MANIFEST_VERSION);
    expect(manifest.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.assets).toEqual([
      expect.objectContaining({ assetId: `aud_${FIRST_PUBLIC_ID}`, sequence: 0, durationMs: 10_125 }),
      expect.objectContaining({ assetId: `aud_${SECOND_PUBLIC_ID}`, sequence: 1, durationMs: 20_000 }),
    ]);
    expect(manifest.chapters).toEqual([
      expect.objectContaining({ sequence: 0, startMs: 0, endMs: 10_125, assetId: `aud_${FIRST_PUBLIC_ID}`, assetOffsetMs: 0 }),
      expect.objectContaining({ sequence: 1, startMs: 10_125, endMs: 30_125, assetId: `aud_${SECOND_PUBLIC_ID}`, assetOffsetMs: 0 }),
    ]);
  });

  it('derives percentage and creates revision one from a matching manifest write', async () => {
    const { service, repo, bookService } = makeFixture();
    const manifest = await service.getManifest(30, makeUser());
    repo.createPlaybackState.mockResolvedValue({
      capturedAt: new Date('2026-02-01T00:00:00.000Z'),
      revision: 1,
    });

    const saved = await service.putPlaybackState(
      30,
      {
        assetId: manifest.assets[1]!.assetId,
        positionMs: 5_000,
        capturedAt: '2026-02-01T00:00:00.000Z',
        operationId: '33333333-3333-4333-8333-333333333333',
        baseRevision: 0,
        manifestRevision: manifest.revision,
      },
      makeUser(),
    );

    expect(saved.percentage).toBeCloseTo((15_125 / 30_125) * 100);
    expect(saved.revision).toBe(1);
    expect(repo.createPlaybackState).toHaveBeenCalledWith(
      7,
      30,
      expect.objectContaining({ currentFileId: 12, positionSeconds: 5, percentage: saved.percentage }),
    );
    expect(bookService.autoUpdateReadStatusForProgress).toHaveBeenCalledWith(7, { bookId: 30, libraryId: 4 }, saved.percentage, {});
  });

  it('rejects stale manifests, unknown assets, and revision conflicts', async () => {
    const { service, repo } = makeFixture();
    const manifest = await service.getManifest(30, makeUser());
    const base = {
      assetId: manifest.assets[0]!.assetId,
      positionMs: 1_000,
      capturedAt: '2026-02-01T00:00:00.000Z',
      operationId: '44444444-4444-4444-8444-444444444444',
      baseRevision: 0,
      manifestRevision: manifest.revision,
    };

    await expect(service.putPlaybackState(30, { ...base, manifestRevision: '0'.repeat(64) }, makeUser())).rejects.toThrow(
      PreconditionFailedException,
    );
    await expect(service.putPlaybackState(30, { ...base, assetId: 'aud_55555555-5555-4555-8555-555555555555' }, makeUser())).rejects.toThrow(
      BadRequestException,
    );

    repo.createPlaybackState.mockResolvedValue(null);
    await expect(service.putPlaybackState(30, base, makeUser())).rejects.toThrow(ConflictException);
  });

  it('resolves asset content through the access-checked file path', async () => {
    const { service, repo, bookService } = makeFixture();
    repo.findAsset.mockResolvedValue({ id: 11, format: 'mp3' });
    bookService.getFileInfo.mockResolvedValue({ path: '/library/Part 1.mp3', size: 1_234, format: 'mp3' });

    await expect(service.getAsset(30, `aud_${FIRST_PUBLIC_ID}`, makeUser())).resolves.toEqual({
      absolutePath: '/library/Part 1.mp3',
      sizeBytes: 1_234,
      format: 'mp3',
    });
    expect(bookService.getFileInfo).toHaveBeenCalledWith(11, expect.objectContaining({ id: 7 }));
  });

  it('requires an actual field when updating an audiobook bookmark', async () => {
    const { service, repo } = makeFixture();

    await expect(service.updateBookmark(30, '66666666-6666-4666-8666-666666666666', {}, makeUser())).rejects.toThrow(BadRequestException);
    expect(repo.updateAudioBookmark).not.toHaveBeenCalled();
  });
});
