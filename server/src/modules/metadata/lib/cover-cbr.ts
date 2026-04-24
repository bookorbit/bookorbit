import { readFile } from 'fs/promises';
import { createExtractorFromData, UnrarError } from 'node-unrar-js';
import { isArchiveImageFile, isHiddenArchivePath } from './archive-image-utils';

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function extractCbrCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const buf = await readFile(absolutePath);
    const ab = toArrayBuffer(buf);

    // First pass: list files to find the first image, sorted naturally.
    const listExtractor = await createExtractorFromData({ data: ab });
    const { fileHeaders } = listExtractor.getFileList();
    const images: { name: string }[] = [];
    try {
      for (const h of fileHeaders) {
        if (!h.flags.directory && isArchiveImageFile(h.name) && !isHiddenArchivePath(h.name)) {
          images.push(h);
        }
      }
    } catch (err) {
      // Some RAR 1.5 archives throw ERAR_BAD_DATA at the end-of-archive marker
      // instead of ERAR_END_ARCHIVE. Accept partial results if we have images.
      if (!(err instanceof UnrarError) || images.length === 0) throw err;
    }
    images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    if (images.length === 0) return null;
    const firstName = images[0].name;

    // Second pass: pass an array so the extractor stops after the first match
    // and never hits the malformed end-of-archive marker in some RAR 1.5 files.
    const extractExtractor = await createExtractorFromData({ data: ab });
    const { files } = extractExtractor.extract({ files: [firstName] });
    let result: Uint8Array | undefined;
    for (const file of files) {
      if (!file.fileHeader.flags.directory) result = file.extraction;
    }

    return result ? Buffer.from(result) : null;
  } catch {
    return null;
  }
}
