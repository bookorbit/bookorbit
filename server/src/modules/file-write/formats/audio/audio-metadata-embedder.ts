import { Injectable } from '@nestjs/common';
import { execFile as execFileCallback } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import sharp from 'sharp';
import { promisify } from 'util';

import { FORMAT_M4A, FORMAT_M4B, FORMAT_MP3 } from '../../file-write.constants';
import { replaceFileAtomically } from '../shared/atomic-file-replace';

const execFile = promisify(execFileCallback);
const FFMPEG_OUTPUT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 60_000;

export interface AudioMetadataArg {
  key: string;
  value: string;
  specifier?: string;
}

export interface AudioMetadataWriteInput {
  coverBytes?: Buffer | null;
  metadata: AudioMetadataArg[];
}

@Injectable()
export class AudioMetadataEmbedder {
  async embedMetadata(filePath: string, format: string, input: AudioMetadataWriteInput): Promise<void> {
    const dir = dirname(filePath);
    const id = randomUUID();
    const coverPath = input.coverBytes ? join(dir, `.bookorbit-cover-${id}.jpg`) : null;
    const tempPath = join(dir, `.bookorbit-write-${id}.${format.toLowerCase()}`);

    try {
      if (coverPath && input.coverBytes) {
        await writeFile(coverPath, await normalizeCoverJpeg(input.coverBytes));
      }
      const useMp4MetadataTags = await shouldUseMp4MetadataTags(filePath, format, coverPath);
      await execFile(resolveFfmpegPath(), buildFfmpegArgs(filePath, coverPath, tempPath, format, input.metadata, { useMp4MetadataTags }), {
        maxBuffer: FFMPEG_OUTPUT_MAX_BUFFER_BYTES,
        timeout: FFMPEG_TIMEOUT_MS,
      });
      await replaceFileAtomically(tempPath, filePath);
    } catch (error) {
      await removeFileIfPresent(tempPath);
      throw error;
    } finally {
      if (coverPath) {
        await removeFileIfPresent(coverPath);
      }
    }
  }
}

function buildFfmpegArgs(
  filePath: string,
  coverPath: string | null,
  tempPath: string,
  format: string,
  metadata: AudioMetadataArg[],
  options?: { useMp4MetadataTags?: boolean },
): string[] {
  const args = ['-v', 'error', '-y', '-i', filePath];

  if (coverPath) {
    args.push('-i', coverPath, '-map', '0:a', '-map', '0:s?', '-map', '1:v:0');
  } else {
    args.push('-map', '0');
  }

  args.push('-map_metadata', '0', '-map_chapters', '0', '-c', 'copy');

  if (format.toLowerCase() === FORMAT_MP3) {
    args.push('-id3v2_version', '3');
  }

  for (const entry of metadata) {
    args.push(entry.specifier ? `-metadata:${entry.specifier}` : '-metadata', `${entry.key}=${entry.value}`);
  }

  const useMp4MetadataTags = options?.useMp4MetadataTags ?? (usesMp4MetadataTags(format) && !coverPath);
  if (useMp4MetadataTags) {
    // ffmpeg drops MP4 covr artwork when use_metadata_tags is combined with an attached picture stream.
    args.push('-movflags', 'use_metadata_tags');
  }

  if (coverPath) {
    args.push('-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)');
  }

  args.push(tempPath);

  return args;
}

function usesMp4MetadataTags(format: string): boolean {
  const normalized = format.toLowerCase();
  return normalized === FORMAT_M4B || normalized === FORMAT_M4A;
}

async function shouldUseMp4MetadataTags(filePath: string, format: string, coverPath: string | null): Promise<boolean> {
  if (!usesMp4MetadataTags(format) || coverPath) return false;
  return !(await hasVideoStream(filePath));
}

async function hasVideoStream(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFile(resolveFfprobePath(), [
      '-v',
      'error',
      '-select_streams',
      'v',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      filePath,
    ]);
    return String(stdout).trim().length > 0;
  } catch {
    return true;
  }
}

async function normalizeCoverJpeg(coverBytes: Buffer): Promise<Buffer> {
  return sharp(coverBytes).jpeg({ quality: 92 }).toBuffer();
}

function resolveFfmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function resolveFfprobePath(): string {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Cleanup is best-effort; preserve the primary write result or error.
  }
}

export const testing = {
  buildFfmpegArgs,
};
