import { Injectable } from '@nestjs/common';
import { open } from 'fs/promises';
import { extname } from 'path';
import { UPLOAD_SUPPORTED_FORMATS } from '@bookorbit/types';

import { uploadError } from './upload-errors';

export const SUPPORTED_BOOK_FORMATS = new Set<string>(UPLOAD_SUPPORTED_FORMATS);

@Injectable()
export class UploadValidatorService {
  /**
   * Returns the normalized extension if valid; throws otherwise.
   * Checks against the global supported set and then any library-level format restriction.
   */
  validateFormat(filename: string, libraryAllowedFormats: string[]): string {
    const ext = extname(filename).toLowerCase().slice(1);
    const normalizedAllowed = libraryAllowedFormats.map((f) => f.trim().toLowerCase()).filter(Boolean);

    if (!SUPPORTED_BOOK_FORMATS.has(ext)) {
      throw uploadError.unsupportedFormat(`Unsupported file type .${ext}. Allowed types: ${[...SUPPORTED_BOOK_FORMATS].join(', ')}`);
    }

    if (normalizedAllowed.length > 0 && !normalizedAllowed.includes(ext)) {
      throw uploadError.formatNotAllowed(`This library does not allow .${ext} files`);
    }

    return ext;
  }

  /**
   * Strips path separators, null bytes, and trims to 255 characters.
   * Preserves the original extension.
   */
  sanitizeFilename(raw: string): string {
    const forbidden = /[/\\:*?"<>|]/;
    const sanitized = [...raw]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 || forbidden.test(character) ? '_' : character;
      })
      .join('')
      .trim();

    if (!sanitized) return 'upload';

    // Dotfile-like names (e.g. ".epub") have no extname() stem.
    if (sanitized.startsWith('.') && !sanitized.slice(1).includes('.')) {
      return `upload${sanitized}`;
    }

    const ext = extname(sanitized);
    if (!ext) return sanitized.slice(0, 255);
    if (ext.length >= 255) return sanitized.slice(0, 255);

    const stem = sanitized
      .slice(0, -ext.length)
      .slice(0, 255 - ext.length)
      .trim();
    return `${stem || 'upload'}${ext}`;
  }

  async validateContent(absolutePath: string, format: string): Promise<void> {
    const handle = await open(absolutePath, 'r');
    try {
      const header = Buffer.alloc(512);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const bytes = header.subarray(0, bytesRead);
      if (!matchesFormatSignature(bytes, format)) {
        throw uploadError.invalidContent(`File contents do not match the .${format} format`);
      }
    } finally {
      await handle.close();
    }
  }
}

function matchesFormatSignature(bytes: Buffer, format: string): boolean {
  if (bytes.length === 0) return false;
  const ascii = bytes.toString('ascii');
  switch (format) {
    case 'epub':
    case 'kepub':
    case 'cbz':
      return bytes[0] === 0x50 && bytes[1] === 0x4b;
    case 'pdf':
      return ascii.startsWith('%PDF-');
    case 'cbr':
      return ascii.startsWith('Rar!\x1a\x07');
    case 'cb7':
      return bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
    case 'mobi':
    case 'azw':
    case 'azw3':
      return ascii.includes('BOOKMOBI');
    case 'fb2':
      return /<\??(?:xml[^>]*>\s*)?(?:[\w-]+:)?FictionBook\b/i.test(bytes.toString('utf8'));
    case 'flac':
      return ascii.startsWith('fLaC');
    case 'ogg':
    case 'opus':
      return ascii.startsWith('OggS');
    case 'm4a':
    case 'm4b':
      return bytes.length >= 12 && ascii.slice(4, 8) === 'ftyp';
    case 'mp3':
      return ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    default:
      return false;
  }
}
