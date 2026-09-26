import { createHash } from 'crypto';
import { mkdtemp, open, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deriveLocalShowMetadata, hashFileHandle, localIdentityHash, readBoundedBinaryFile, readBoundedTextFile } from './podcast-import-files';

describe('podcast import file utilities', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'podcast-import-files-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads only the configured text prefix and returns null for unreadable paths', async () => {
    const path = join(root, 'metadata.json');
    await writeFile(path, '0123456789');

    await expect(readBoundedTextFile(path, 4)).resolves.toBe('0123');
    await expect(readBoundedTextFile(join(root, 'missing.json'), 4)).resolves.toBeNull();
    await expect(readBoundedTextFile(root, 4)).resolves.toBeNull();
  });

  it('returns complete bounded binary files and rejects oversized files', async () => {
    const path = join(root, 'cover.jpg');
    await writeFile(path, Buffer.from('cover'));

    await expect(readBoundedBinaryFile(path, 5)).resolves.toEqual(Buffer.from('cover'));
    await expect(readBoundedBinaryFile(path, 4)).resolves.toBeNull();
  });

  it('derives show metadata with sidecar precedence and field limits', async () => {
    const metadataPath = join(root, 'metadata.json');
    await writeFile(
      metadataPath,
      JSON.stringify({
        title: ' Sidecar title ',
        artist: ' Sidecar artist ',
        description: 'd'.repeat(100_001),
      }),
    );

    await expect(
      deriveLocalShowMetadata({
        path: root,
        folderTitle: 'Folder title',
        metadataSidecarPath: metadataPath,
        albumTags: new Set(['Album title']),
        artistTags: new Set(['Tag artist']),
      }),
    ).resolves.toEqual({
      title: 'Sidecar title',
      author: 'Sidecar artist',
      description: 'd'.repeat(100_000),
    });
  });

  it('streams a checksum from an open file handle', async () => {
    const path = join(root, 'episode.mp3');
    await writeFile(path, 'episode bytes');
    const handle = await open(path, 'r');

    try {
      await expect(hashFileHandle(handle)).resolves.toBe(createHash('sha256').update('episode bytes').digest('hex'));
    } finally {
      await handle.close().catch(() => undefined);
    }
  });

  it('keeps local identities deterministic and separate from the raw checksum', () => {
    const checksum = createHash('sha256').update('episode bytes').digest('hex');

    expect(localIdentityHash(checksum)).toBe(createHash('sha256').update(`local:${checksum}`).digest('hex'));
    expect(localIdentityHash(checksum)).not.toBe(checksum);
  });
});
