import { createHash } from 'crypto';
import type { FileHandle } from 'fs/promises';
import { open } from 'fs/promises';
import { basename } from 'path';

const SIDECAR_MAX_BYTES = 512 * 1024;
const MAX_LOCAL_DESCRIPTION_LENGTH = 100_000;

export class PodcastImportCancelledError extends Error {
  constructor() {
    super('Podcast import scan was cancelled');
    this.name = 'PodcastImportCancelledError';
  }
}

export interface PodcastImportFolderMetadataContext {
  path: string;
  folderTitle: string | null;
  metadataSidecarPath: string | null;
  albumTags: Set<string>;
  artistTags: Set<string>;
}

export interface LocalShowMetadata {
  title: string;
  author: string | null;
  description: string | null;
}

export async function deriveLocalShowMetadata(folder: PodcastImportFolderMetadataContext): Promise<LocalShowMetadata> {
  const sidecar = folder.metadataSidecarPath ? await readMetadataSidecar(folder.metadataSidecarPath) : null;
  const unanimousAlbum = folder.albumTags.size === 1 ? [...folder.albumTags][0]! : null;
  const unanimousArtist = folder.artistTags.size === 1 ? [...folder.artistTags][0]! : null;
  return {
    title: (sidecar?.title ?? unanimousAlbum ?? folder.folderTitle ?? basename(folder.path)).slice(0, 1000),
    author: (sidecar?.author ?? unanimousArtist)?.slice(0, 1000) ?? null,
    description: sidecar?.description?.slice(0, MAX_LOCAL_DESCRIPTION_LENGTH) ?? null,
  };
}

/** Reads at most `maxBytes`, so a sidecar someone left at gigabyte size cannot be pulled into memory. */
export async function readBoundedTextFile(path: string, maxBytes: number): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0) return null;
    const buffer = Buffer.alloc(Math.min(info.size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Reads a complete bounded binary file, for sidecars that are images rather than text. */
export async function readBoundedBinaryFile(path: string, maxBytes: number): Promise<Buffer | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0 || info.size > maxBytes) return null;
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    return bytesRead === 0 ? null : buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Prefixing the digest keeps local-file identities disjoint from feed GUID/enclosure identities,
 * including after a merge places both episode origins under one show.
 */
export function localIdentityHash(fileChecksum: string): string {
  return createHash('sha256').update(`local:${fileChecksum}`).digest('hex');
}

export async function hashFileHandle(handle: FileHandle): Promise<string> {
  const hash = createHash('sha256');
  const stream = handle.createReadStream({ autoClose: false, start: 0 });
  try {
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } finally {
    stream.destroy();
  }
  return hash.digest('hex');
}

async function readMetadataSidecar(path: string): Promise<{ title: string | null; author: string | null; description: string | null } | null> {
  const raw = await readBoundedTextFile(path, SIDECAR_MAX_BYTES);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      title: sidecarText(parsed.title),
      author: sidecarText(parsed.author) ?? sidecarText(parsed.artist),
      description: sidecarText(parsed.description),
    };
  } catch {
    return null;
  }
}

function sidecarText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
