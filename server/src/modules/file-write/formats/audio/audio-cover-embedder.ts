import { Injectable } from '@nestjs/common';
import { execFile as execFileCallback } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import sharp from 'sharp';
import { promisify } from 'util';

import { FORMAT_MP3 } from '../../file-write.constants';
import { replaceFileAtomically } from '../shared/atomic-file-replace';

const execFile = promisify(execFileCallback);
const FFMPEG_OUTPUT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 60_000;

@Injectable()
export class AudioCoverEmbedder {
  async embedCover(filePath: string, coverBytes: Buffer, format: string): Promise<void> {
    const dir = dirname(filePath);
    const id = randomUUID();
    const coverPath = join(dir, `.bookorbit-cover-${id}.jpg`);
    const tempPath = join(dir, `.bookorbit-write-${id}.${format.toLowerCase()}`);

    try {
      await writeFile(coverPath, await normalizeCoverJpeg(coverBytes));
      await execFile(resolveFfmpegPath(), buildFfmpegArgs(filePath, coverPath, tempPath, format), {
        maxBuffer: FFMPEG_OUTPUT_MAX_BUFFER_BYTES,
        timeout: FFMPEG_TIMEOUT_MS,
      });
      await replaceFileAtomically(tempPath, filePath);
    } catch (error) {
      await removeFileIfPresent(tempPath);
      throw error;
    } finally {
      await removeFileIfPresent(coverPath);
    }
  }
}

function buildFfmpegArgs(filePath: string, coverPath: string, tempPath: string, format: string): string[] {
  const args = ['-y', '-i', filePath, '-i', coverPath, '-map', '0:a', '-map', '1:v:0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy'];

  if (format.toLowerCase() === FORMAT_MP3) {
    args.push('-id3v2_version', '3');
  }

  args.push('-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)', tempPath);

  return args;
}

async function normalizeCoverJpeg(coverBytes: Buffer): Promise<Buffer> {
  return sharp(coverBytes).jpeg({ quality: 92 }).toBuffer();
}

function resolveFfmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === code);
}

export const testing = {
  buildFfmpegArgs,
};
