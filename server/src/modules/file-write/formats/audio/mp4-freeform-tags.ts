import { open, type FileHandle } from 'fs/promises';

/**
 * Tags FFmpeg writes as standard iTunes atoms. Every other tag only survives in an MP4 as an iTunes
 * freeform (`----`) atom, which FFmpeg cannot write: its `use_metadata_tags` mode stores them as
 * QuickTime keys instead, but then drops the `covr` cover art.
 */
export const MP4_NATIVE_TAG_KEYS: ReadonlySet<string> = new Set([
  'title',
  'artist',
  'album_artist',
  'composer',
  'album',
  'date',
  'encoder',
  'encoding_tool',
  'comment',
  'genre',
  'copyright',
  'grouping',
  'lyrics',
  'description',
  'synopsis',
  'show',
  'episode_id',
  'network',
  'keywords',
  'episode_sort',
  'season_number',
  'media_type',
  'hd_video',
  'gapless_playback',
  'compilation',
  'track',
  'disc',
  'tmpo',
]);

export interface Mp4FreeformTag {
  name: string;
  /** An empty value clears the tag, as `-metadata key=` does for FFmpeg. */
  value: string;
}

// The other names the audio extractor reads for a field: a stale copy from another tagger would
// otherwise survive beside the new value.
const SUPERSEDED_NAMES: Readonly<Record<string, readonly string[]>> = {
  'series-part': ['part', 'series_part', 'seriespart'],
};

// FFmpeg turns iTunSMPB into its own encoder-delay handling on read, so a copied one could trim the
// audio a second time.
const NEVER_CARRIED_NAMES: ReadonlySet<string> = new Set(['itunsmpb']);

const MAX_USER_DATA_BYTES = 64 * 1024 * 1024;
const ITUNES_MEAN = 'com.apple.iTunes';
const DATA_TYPE_UTF8 = 1;

interface Box {
  type: string;
  start: number;
  bodyStart: number;
  end: number;
}

interface FreeformAtom {
  name: string;
  bytes: Buffer;
}

class MalformedMp4Error extends Error {}

/**
 * Writes `tags` into `targetPath`, an MP4 FFmpeg has just written, as freeform atoms. Freeform tags in
 * `carryOverFrom` that this write does not replace are copied across, so a file keeps tags such as
 * Audible's that BookOrbit does not manage.
 *
 * Only the end of the file changes: FFmpeg writes the movie box last, so the audio and every chunk
 * offset stay where they are.
 */
export async function writeMp4FreeformTags(targetPath: string, tags: Mp4FreeformTag[], options: { carryOverFrom?: string } = {}): Promise<void> {
  const replaced = replacedNames(tags);
  const carried = options.carryOverFrom ? await readFreeformAtoms(options.carryOverFrom) : [];
  const atoms = [
    ...carried
      .filter((atom) => !replaced.has(atom.name.toLowerCase()) && !NEVER_CARRIED_NAMES.has(atom.name.toLowerCase()))
      .map((atom) => atom.bytes),
    ...tags.filter((tag) => tag.value.length > 0).map((tag) => encodeFreeformAtom(tag.name, tag.value)),
  ];

  const handle = await open(targetPath, 'r+');
  try {
    const { size } = await handle.stat();
    const moov = (await readChildBoxes(handle, 0, size)).find((child) => child.type === 'moov');
    if (!moov) throw new MalformedMp4Error('MP4 has no movie box');
    if (moov.end !== size) throw new MalformedMp4Error('MP4 movie box is not at the end of the file');

    const udta = (await readChildBoxes(handle, moov.bodyStart, moov.end)).find((child) => child.type === 'udta');
    const tailStart = udta ? udta.start : moov.end;
    if (moov.end - tailStart > MAX_USER_DATA_BYTES) throw new MalformedMp4Error('MP4 user data box is too large to rewrite');

    const tail = await readBytes(handle, tailStart, moov.end - tailStart);
    const oldUdtaLength = udta ? udta.end - udta.start : 0;
    const newUdta = udta ? rebuildUdta(tail.subarray(0, oldUdtaLength), atoms, replaced) : box('udta', newMeta(atoms));
    const newTail = Buffer.concat([newUdta, tail.subarray(oldUdtaLength)]);

    const header = Buffer.alloc(moov.bodyStart - moov.start);
    header.write('moov', 4, 'latin1');
    setBoxSize(header, 0, header.length, moov.end - moov.start + newTail.length - tail.length);
    await handle.write(header, 0, header.length, moov.start);
    await handle.write(newTail, 0, newTail.length, tailStart);
    await handle.truncate(tailStart + newTail.length);
  } finally {
    await handle.close();
  }
}

/** Every freeform name a write of `tags` replaces, lower-cased. */
function replacedNames(tags: Mp4FreeformTag[]): Set<string> {
  // A freeform copy of a native tag would shadow the value FFmpeg just wrote.
  const names = new Set<string>(MP4_NATIVE_TAG_KEYS);
  for (const tag of tags) {
    const name = tag.name.toLowerCase();
    names.add(name);
    for (const alias of SUPERSEDED_NAMES[name] ?? []) names.add(alias);
  }
  return names;
}

/** The freeform atoms of an MP4, raw. A file without readable iTunes metadata has none. */
async function readFreeformAtoms(filePath: string): Promise<FreeformAtom[]> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const moov = (await readChildBoxes(handle, 0, size)).find((child) => child.type === 'moov');
    const udta = moov ? (await readChildBoxes(handle, moov.bodyStart, moov.end)).find((child) => child.type === 'udta') : undefined;
    if (!udta) return [];
    if (udta.end - udta.start > MAX_USER_DATA_BYTES) throw new Error('MP4 user data box is too large to read');

    const bytes = await readBytes(handle, udta.start, udta.end - udta.start);
    const meta = childBoxes(bytes, parseBox(bytes, 0, bytes.length).bodyStart, bytes.length).find((child) => child.type === 'meta');
    const ilst = meta ? findItunesIlst(bytes, meta) : null;
    if (!ilst) return [];
    return childBoxes(bytes, ilst.bodyStart, ilst.end).flatMap((child) => {
      const name = child.type === '----' ? freeformName(bytes, child) : null;
      return name ? [{ name, bytes: Buffer.from(bytes.subarray(child.start, child.end)) }] : [];
    });
  } catch (error) {
    if (error instanceof MalformedMp4Error) return [];
    throw error;
  } finally {
    await handle.close();
  }
}

function rebuildUdta(udtaBytes: Buffer, atoms: Buffer[], replaced: Set<string>): Buffer {
  const udta = parseBox(udtaBytes, 0, udtaBytes.length);
  const children = childBoxes(udtaBytes, udta.bodyStart, udta.end);
  const meta = children.find((child) => child.type === 'meta');
  if (!meta) return box('udta', ...children.map((child) => udtaBytes.subarray(child.start, child.end)), newMeta(atoms));

  const ilst = findItunesIlst(udtaBytes, meta);
  if (!ilst) throw new MalformedMp4Error('MP4 metadata is not in iTunes form');

  const kept = childBoxes(udtaBytes, ilst.bodyStart, ilst.end)
    .filter((child) => {
      const name = child.type === '----' ? freeformName(udtaBytes, child) : null;
      return !name || !replaced.has(name.toLowerCase());
    })
    .map((child) => udtaBytes.subarray(child.start, child.end));
  const newIlst = box('ilst', ...kept, ...atoms);
  const delta = newIlst.length - (ilst.end - ilst.start);

  // Splice the new ilst in place and grow its two ancestors by the same amount.
  const rebuilt = Buffer.concat([udtaBytes.subarray(0, ilst.start), newIlst, udtaBytes.subarray(ilst.end)]);
  setBoxSize(rebuilt, meta.start, meta.bodyStart - meta.start, meta.end - meta.start + delta);
  setBoxSize(rebuilt, udta.start, udta.bodyStart - udta.start, udta.end - udta.start + delta);
  return rebuilt;
}

function newMeta(atoms: Buffer[]): Buffer {
  const hdlr = fullBox('hdlr', Buffer.concat([uint32(0), Buffer.from('mdirappl', 'latin1'), Buffer.alloc(9)]));
  return fullBox('meta', Buffer.concat([hdlr, box('ilst', ...atoms)]));
}

function encodeFreeformAtom(name: string, value: string): Buffer {
  return box(
    '----',
    fullBox('mean', Buffer.from(ITUNES_MEAN, 'utf8')),
    fullBox('name', Buffer.from(name, 'utf8')),
    box('data', uint32(DATA_TYPE_UTF8), uint32(0), Buffer.from(value, 'utf8')),
  );
}

/** The ilst of an iTunes (`mdir`) meta box; a QuickTime keys (`mdta`) one holds no freeform atoms. */
function findItunesIlst(bytes: Buffer, meta: Box): Box | null {
  // iTunes writes meta as a full box; QuickTime writes it without version and flags.
  const plain = meta.bodyStart + 8 <= meta.end && bytes.toString('latin1', meta.bodyStart + 4, meta.bodyStart + 8) === 'hdlr';
  const children = childBoxes(bytes, plain ? meta.bodyStart : meta.bodyStart + 4, meta.end);
  const hdlr = children.find((child) => child.type === 'hdlr');
  if (!hdlr || hdlr.bodyStart + 12 > hdlr.end || bytes.toString('latin1', hdlr.bodyStart + 8, hdlr.bodyStart + 12) !== 'mdir') return null;
  return children.find((child) => child.type === 'ilst') ?? null;
}

function freeformName(bytes: Buffer, freeform: Box): string | null {
  const name = childBoxes(bytes, freeform.bodyStart, freeform.end).find((child) => child.type === 'name');
  return name && name.end - name.bodyStart > 4 ? bytes.toString('utf8', name.bodyStart + 4, name.end) : null;
}

/** Decodes the header at `at`, where `remaining` bytes are left in its parent. */
function decodeHeader(bytes: Buffer, at: number, remaining: number): { type: string; headerSize: number; size: number } {
  if (remaining < 8 || bytes.length < at + 8) throw new MalformedMp4Error('MP4 box header runs past its parent');
  let size = bytes.readUInt32BE(at);
  let headerSize = 8;
  if (size === 1) {
    if (remaining < 16 || bytes.length < at + 16) throw new MalformedMp4Error('MP4 box header runs past its parent');
    size = Number(bytes.readBigUInt64BE(at + 8));
    headerSize = 16;
  } else if (size === 0) {
    size = remaining;
  }
  if (size < headerSize || size > remaining) throw new MalformedMp4Error('MP4 box size runs past its parent');
  return { type: bytes.toString('latin1', at + 4, at + 8), headerSize, size };
}

function parseBox(bytes: Buffer, offset: number, limit: number): Box {
  const { type, headerSize, size } = decodeHeader(bytes, offset, limit - offset);
  return { type, start: offset, bodyStart: offset + headerSize, end: offset + size };
}

// Fewer than 8 trailing bytes are padding: QuickTime may end a user data list with a zero terminator.
function childBoxes(bytes: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  for (let offset = start; offset + 8 <= end;) {
    const child = parseBox(bytes, offset, end);
    boxes.push(child);
    offset = child.end;
  }
  return boxes;
}

/** Walks the box headers of a file region without reading bodies, so a large mdat costs nothing. */
async function readChildBoxes(handle: FileHandle, start: number, end: number): Promise<Box[]> {
  const boxes: Box[] = [];
  for (let offset = start; offset + 8 <= end;) {
    const header = await readBytes(handle, offset, Math.min(16, end - offset));
    const { type, headerSize, size } = decodeHeader(header, 0, end - offset);
    boxes.push({ type, start: offset, bodyStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

async function readBytes(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new MalformedMp4Error('MP4 ended inside a box');
  return buffer;
}

function setBoxSize(bytes: Buffer, at: number, headerSize: number, size: number): void {
  if (headerSize === 16) {
    bytes.writeUInt32BE(1, at);
    bytes.writeBigUInt64BE(BigInt(size), at + 8);
    return;
  }
  if (size > 0xffffffff) throw new MalformedMp4Error('MP4 box grew past the 32-bit size limit');
  bytes.writeUInt32BE(size, at);
}

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

function fullBox(type: string, body: Buffer): Buffer {
  return box(type, uint32(0), body);
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value, 0);
  return bytes;
}
