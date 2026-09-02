import { BadRequestException } from '@nestjs/common';
import { MAX_TORRENT_FILE_BYTES } from '@bookorbit/types';
import { createHash } from 'crypto';

export { MAX_TORRENT_FILE_BYTES };

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HEX_INFO_HASH = /^[0-9a-f]{40}$/i;
const BASE32_INFO_HASH = /^[A-Z2-7]{32}$/i;
const MAX_TORRENT_FILES = 2_000;
const MAX_PATH_PARTS = 32;
const MAX_PATH_PART_BYTES = 255;
const MAX_BENCODE_DEPTH = 32;
const MAX_BENCODE_VALUES = 20_000;

export interface TorrentManifestEntry {
  path: string;
  length: number | null;
}

export interface TorrentFileMetadata {
  infoHash: string;
  name: string | null;
  totalLength: number | null;
  files: TorrentManifestEntry[];
}

/**
 * qBittorrent's add endpoint answers "Ok." and nothing else, so the infohash has to come from the
 * payload rather than from the client. Everything downstream keys on it: the poll loop, the
 * partial unique index, and the eventual remove.
 */
export function infoHashFromMagnet(magnet: string): string {
  const trimmed = magnet.trim();
  if (!trimmed.toLowerCase().startsWith('magnet:?')) {
    throw new BadRequestException('That is not a magnet link');
  }

  let params: URLSearchParams;
  try {
    params = new URL(trimmed).searchParams;
  } catch {
    throw new BadRequestException('That magnet link could not be parsed');
  }

  for (const xt of params.getAll('xt')) {
    const value = xt.replace(/^urn:btih:/i, '');
    if (value === xt) continue;
    if (HEX_INFO_HASH.test(value)) return value.toLowerCase();
    if (BASE32_INFO_HASH.test(value)) return base32ToHex(value.toUpperCase());
  }

  throw new BadRequestException('That magnet link has no BitTorrent v1 infohash');
}

export function magnetDisplayName(magnet: string, fallback: string): string {
  try {
    const name = new URL(magnet.trim()).searchParams.get('dn');
    return name?.trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * SHA-1 of the bencoded `info` value, taken as raw bytes out of the original buffer rather than
 * re-encoded from a parsed structure: a round trip through JavaScript objects loses key order and
 * would produce a hash no tracker recognises.
 */
export function torrentMetadataFromFile(buffer: Buffer): TorrentFileMetadata {
  const reader = new BencodeReader(buffer);
  const root = reader.readDictionaryEntries();

  const info = root.get('info');
  if (!info) throw new BadRequestException('That .torrent file has no info dictionary');

  const infoHash = createHash('sha1').update(buffer.subarray(info.start, info.end)).digest('hex');

  const infoEntries = new BencodeReader(buffer, info.start).readDictionaryEntries();
  const nameEntry = infoEntries.get('name.utf-8') ?? infoEntries.get('name');
  const name = nameEntry ? decodeBencodedString(buffer, nameEntry) : null;
  const files = torrentManifestFiles(buffer, infoEntries, name);

  return { infoHash, name, totalLength: totalContentLength(buffer, infoEntries, files), files };
}

/**
 * The size of what the torrent carries, which is not the size of the torrent file. Single-file
 * torrents carry `length`; multi-file ones carry a `files` list whose lengths sum to the same
 * thing. Null when neither is readable, so a bad parse records nothing rather than a wrong number.
 */
function totalContentLength(buffer: Buffer, infoEntries: Map<string, ValueSpan>, files: TorrentManifestEntry[]): number | null {
  const single = infoEntries.get('length');
  if (single) return decodeBencodedInteger(buffer, single);

  let total = 0;
  let seen = false;
  for (const file of files) {
    if (file.length === null) continue;
    total += file.length;
    seen = true;
  }
  return seen ? total : null;
}

function torrentManifestFiles(buffer: Buffer, infoEntries: Map<string, ValueSpan>, rootName: string | null): TorrentManifestEntry[] {
  const listEntry = infoEntries.get('files');
  if (!listEntry) {
    const lengthEntry = infoEntries.get('length');
    if (!rootName) return [];
    return [{ path: validatePathPart(rootName), length: lengthEntry ? decodeBencodedInteger(buffer, lengthEntry) : null }];
  }

  const entries = new BencodeReader(buffer, listEntry.start).readListEntries(MAX_TORRENT_FILES + 1);
  if (entries.length > MAX_TORRENT_FILES) throw new BadRequestException(`That .torrent file lists more than ${MAX_TORRENT_FILES} files`);

  const root = rootName ? validatePathPart(rootName) : null;
  return entries.map((entry) => {
    const fields = new BencodeReader(buffer, entry.start).readDictionaryEntries();
    const pathEntry = fields.get('path.utf-8') ?? fields.get('path');
    if (!pathEntry) throw new BadRequestException('That .torrent file has a file with no path');

    const parts = new BencodeReader(buffer, pathEntry.start).readListEntries(MAX_PATH_PARTS + 1);
    if (parts.length === 0) throw new BadRequestException('That .torrent file has an empty file path');
    if (parts.length > MAX_PATH_PARTS) throw new BadRequestException('That .torrent file has a path nested too deeply');

    const path = [...(root ? [root] : []), ...parts.map((part) => validatePathPart(decodeBencodedString(buffer, part)))].join('/');
    const lengthEntry = fields.get('length');
    return { path, length: lengthEntry ? decodeBencodedInteger(buffer, lengthEntry) : null };
  });
}

function validatePathPart(value: string | null): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || hasControlCharacter(value)) {
    throw new BadRequestException('That .torrent file contains an unsafe file path');
  }
  if (Buffer.byteLength(value) > MAX_PATH_PART_BYTES) throw new BadRequestException('That .torrent file contains a file name that is too long');
  return value;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
}

function decodeBencodedInteger(buffer: Buffer, span: ValueSpan): number | null {
  if (buffer[span.start] !== 0x69) return null;
  const value = Number(buffer.subarray(span.start + 1, span.end - 1).toString('ascii'));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

interface ValueSpan {
  start: number;
  end: number;
}

function decodeBencodedString(buffer: Buffer, span: ValueSpan): string | null {
  const colon = buffer.indexOf(0x3a, span.start);
  if (colon === -1 || colon >= span.end) return null;
  return buffer.subarray(colon + 1, span.end).toString('utf8');
}

/**
 * A deliberately small bencode scanner: it walks values to find their byte spans and never
 * materialises the tree. That is all the infohash needs, and it keeps a hostile .torrent from
 * turning into an unbounded allocation.
 */
class BencodeReader {
  private position: number;
  private valuesRead = 0;

  constructor(
    private readonly buffer: Buffer,
    start = 0,
  ) {
    this.position = start;
  }

  readDictionaryEntries(): Map<string, ValueSpan> {
    const entries = new Map<string, ValueSpan>();
    if (this.buffer[this.position] !== 0x64) throw new BadRequestException('That .torrent file is not a bencoded dictionary');
    this.position++;

    while (this.position < this.buffer.length && this.buffer[this.position] !== 0x65) {
      const keySpan = this.skipValue();
      const key = decodeBencodedString(this.buffer, keySpan);
      const valueSpan = this.skipValue();
      if (key !== null && !entries.has(key)) entries.set(key, valueSpan);
    }

    if (this.buffer[this.position] !== 0x65) throw new BadRequestException('That .torrent file is truncated');

    return entries;
  }

  readListEntries(limit = Number.POSITIVE_INFINITY): ValueSpan[] {
    const entries: ValueSpan[] = [];
    if (this.buffer[this.position] !== 0x6c) return entries;
    this.position++;

    while (this.position < this.buffer.length && this.buffer[this.position] !== 0x65) {
      entries.push(this.skipValue());
      if (entries.length >= limit) break;
    }
    return entries;
  }

  private skipValue(depth = 0): ValueSpan {
    if (depth > MAX_BENCODE_DEPTH) throw new BadRequestException('That .torrent file is nested too deeply');
    if (++this.valuesRead > MAX_BENCODE_VALUES) throw new BadRequestException('That .torrent file contains too many metadata values');
    const start = this.position;
    const marker = this.buffer[this.position];
    if (marker === undefined) throw new BadRequestException('That .torrent file is truncated');

    if (marker === 0x69) {
      this.skipUntil(0x65);
      this.position++;
    } else if (marker === 0x6c || marker === 0x64) {
      this.position++;
      while (this.position < this.buffer.length && this.buffer[this.position] !== 0x65) this.skipValue(depth + 1);
      if (this.buffer[this.position] !== 0x65) throw new BadRequestException('That .torrent file is truncated');
      this.position++;
    } else if (marker >= 0x30 && marker <= 0x39) {
      const colon = this.buffer.indexOf(0x3a, this.position);
      if (colon === -1) throw new BadRequestException('That .torrent file is truncated');
      const length = Number(this.buffer.subarray(this.position, colon).toString('ascii'));
      if (!Number.isSafeInteger(length) || length < 0) throw new BadRequestException('That .torrent file is malformed');
      this.position = colon + 1 + length;
      if (this.position > this.buffer.length) throw new BadRequestException('That .torrent file is truncated');
    } else {
      throw new BadRequestException('That .torrent file is malformed');
    }

    return { start, end: this.position };
  }

  private skipUntil(byte: number): void {
    const index = this.buffer.indexOf(byte, this.position);
    if (index === -1) throw new BadRequestException('That .torrent file is truncated');
    this.position = index;
  }
}

function base32ToHex(value: string): string {
  let bits = '';
  for (const char of value) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new BadRequestException('That magnet link has a malformed infohash');
    bits += index.toString(2).padStart(5, '0');
  }

  let hex = '';
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    hex += parseInt(bits.slice(i, i + 8), 2)
      .toString(16)
      .padStart(2, '0');
  }
  return hex;
}
