import { createReadStream, createWriteStream } from 'fs';
import { open, unlink } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';

import { decodeFb2, detectFb2Encoding, encodeFb2, isFb2EncodingSupported, type Fb2Encoding } from '../../../../common/utils/fb2-encoding.utils';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { inspectCoverImage } from '../shared/cover-image';
import { buildBinaryElement, findBinarySpan, findRootCloseOffset } from './fb2-binary-locator';
import { buildFb2Description, readCoverEntryId } from './fb2-description-builder';
import { Fb2StructureError, findElementClose, findTagEnd } from './fb2-element-scanner';

/**
 * Metadata lives in the <description> element at the very start of an FB2 file,
 * so the writer only decodes a leading window instead of the whole book.
 */
const HEAD_WINDOW_BYTES = 256 * 1024;
const MAX_HEAD_WINDOW_BYTES = 8 * 1024 * 1024;
const DEFAULT_COVER_ENTRY_ID = 'bookorbit-cover';
const STREAM_CHUNK_BYTES = 1024 * 1024;

export type Fb2WriteOutcome =
  { status: 'success'; fieldsWritten: BookWritePayloadKey[] } | { status: 'skipped'; reason: string; fieldsWritten: BookWritePayloadKey[] };

type SourceRange = { kind: 'range'; start: number; end: number };
type LiteralBytes = { kind: 'bytes'; bytes: Buffer };
type OutputPart = SourceRange | LiteralBytes;

type DescriptionLocation = {
  startByte: number;
  endByte: number;
  descriptionXml: string;
  xlinkPrefix: string;
};

export async function writeFb2Metadata(
  filePath: string,
  payload: BookWritePayload,
  fieldMask: Set<BookWritePayloadKey>,
  options: { dryRun: boolean },
): Promise<Fb2WriteOutcome> {
  const handle = await open(filePath, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    const encoding = await readEncoding(handle, fileSize);
    if (!isFb2EncodingSupported(encoding)) {
      return { status: 'skipped', reason: `unsupported encoding: ${encoding.declared ?? encoding.name}`, fieldsWritten: [] };
    }

    let location: DescriptionLocation | null;
    try {
      location = await locateDescription(handle, fileSize, encoding);
    } catch (error) {
      if (error instanceof Fb2StructureError) {
        return { status: 'skipped', reason: error.message, fieldsWritten: [] };
      }
      throw error;
    }
    if (!location) {
      return { status: 'skipped', reason: 'no description block found', fieldsWritten: [] };
    }

    const writesCover = Boolean(payload.coverBytes?.length) && fieldMask.has('coverBytes');
    const existingCoverEntryId = writesCover ? readCoverEntryId(location.descriptionXml, location.xlinkPrefix) : null;
    const coverImage = writesCover ? await inspectCoverImage(payload.coverBytes!) : null;
    const coverEntryId = writesCover ? (existingCoverEntryId ?? `${DEFAULT_COVER_ENTRY_ID}.${coverImage!.extension}`) : null;

    const built = buildFb2Description(location.descriptionXml, payload, fieldMask, { xlinkPrefix: location.xlinkPrefix, coverEntryId });
    if (built.status === 'skipped') {
      return { status: 'skipped', reason: built.reason, fieldsWritten: [] };
    }

    const fieldsWritten = [...built.fieldsWritten];
    if (writesCover) fieldsWritten.push('coverBytes');

    if (fieldsWritten.length === 0) {
      return { status: 'skipped', reason: 'no metadata to write', fieldsWritten: [] };
    }
    if (options.dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten };
    }

    const parts: OutputPart[] = [
      { kind: 'range', start: 0, end: location.startByte },
      { kind: 'bytes', bytes: encodeFb2(built.descriptionXml, encoding) },
    ];

    if (writesCover) {
      const binaryXml = buildBinaryElement(coverEntryId!, coverImage!.mediaType, payload.coverBytes!);
      const existingSpan = await findBinarySpan(handle, coverEntryId!, location.endByte, fileSize);
      if (existingSpan) {
        parts.push({ kind: 'range', start: location.endByte, end: existingSpan.start });
        parts.push({ kind: 'bytes', bytes: encodeFb2(binaryXml, encoding) });
        parts.push({ kind: 'range', start: existingSpan.end, end: fileSize });
      } else {
        const rootCloseAt = await findRootCloseOffset(handle, fileSize);
        if (rootCloseAt === null) {
          return { status: 'skipped', reason: 'no closing FictionBook tag found', fieldsWritten: [] };
        }
        parts.push({ kind: 'range', start: location.endByte, end: rootCloseAt });
        parts.push({ kind: 'bytes', bytes: encodeFb2(`${binaryXml}\n`, encoding) });
        parts.push({ kind: 'range', start: rootCloseAt, end: fileSize });
      }
    } else {
      parts.push({ kind: 'range', start: location.endByte, end: fileSize });
    }

    await writeParts(filePath, parts);
    return { status: 'success', fieldsWritten };
  } finally {
    await handle.close();
  }
}

async function readEncoding(handle: FileHandle, fileSize: number): Promise<Fb2Encoding> {
  const length = Math.min(1024, Math.max(fileSize, 1));
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, 0);
  return detectFb2Encoding(buffer.subarray(0, bytesRead));
}

/**
 * Reads a leading window and resolves the byte span of <description>. The window
 * grows when the block is unusually large (for example a very long annotation)
 * and gives up rather than buffering an entire book.
 */
async function locateDescription(handle: FileHandle, fileSize: number, encoding: Fb2Encoding): Promise<DescriptionLocation | null> {
  for (let windowBytes = HEAD_WINDOW_BYTES; ; windowBytes *= 4) {
    const length = Math.min(windowBytes, fileSize);
    const buffer = Buffer.alloc(Math.max(length, 1));
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const headText = decodeFb2(buffer.subarray(0, bytesRead), encoding);

    const descriptionAt = headText.search(/<description[\s>]/);
    if (descriptionAt < 0) {
      if (length >= fileSize || windowBytes >= MAX_HEAD_WINDOW_BYTES) return null;
      continue;
    }

    const bodyAt = headText.search(/<body[\s>]/);
    if (bodyAt >= 0 && bodyAt < descriptionAt) {
      throw new Fb2StructureError('body precedes description');
    }

    let endOffset: number;
    try {
      const contentStart = findTagEnd(headText, descriptionAt) + 1;
      endOffset = findTagEnd(headText, findElementClose(headText, 'description', contentStart)) + 1;
    } catch (error) {
      const exhausted = length >= fileSize || windowBytes >= MAX_HEAD_WINDOW_BYTES;
      if (exhausted) throw error;
      continue;
    }

    const xlinkPrefix = headText.match(/xmlns:([\w.-]+)\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xlink["']/)?.[1] ?? 'l';

    return {
      startByte: encodeFb2(headText.slice(0, descriptionAt), encoding).length,
      endByte: encodeFb2(headText.slice(0, endOffset), encoding).length,
      descriptionXml: headText.slice(descriptionAt, endOffset),
      xlinkPrefix,
    };
  }
}

/** Streams the assembled output to a sibling temp file, then swaps it in atomically. */
async function writeParts(filePath: string, parts: OutputPart[]): Promise<void> {
  const tempPath = join(dirname(filePath), `.fb2-write-${randomUUID()}`);
  const output = createWriteStream(tempPath);

  try {
    for (const part of parts) {
      if (part.kind === 'bytes') {
        await writeBuffer(output, part.bytes);
        continue;
      }
      if (part.end <= part.start) continue;
      await pipeline(createReadStream(filePath, { start: part.start, end: part.end - 1, highWaterMark: STREAM_CHUNK_BYTES }), output, {
        end: false,
      });
    }
    await closeStream(output);
  } catch (error) {
    output.destroy();
    await unlink(tempPath).catch(() => {});
    throw error;
  }

  await replaceFileAtomically(tempPath, filePath);
}

function writeBuffer(output: ReturnType<typeof createWriteStream>, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

function closeStream(output: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    output.end(() => resolve());
    output.once('error', reject);
  });
}
