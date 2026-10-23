import { Injectable } from '@nestjs/common';
import { execFile as execFileCallback } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import sharp from 'sharp';
import { promisify } from 'util';

import { FORMAT_M4A, FORMAT_M4B, FORMAT_MP3 } from '../../file-write.constants';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { FfmpegStalledError, runFfmpeg } from './ffmpeg-runner';
import { MP4_NATIVE_TAG_KEYS, writeMp4FreeformTags, type Mp4FreeformTag } from './mp4-freeform-tags';

const execFile = promisify(execFileCallback);
const FFPROBE_TIMEOUT_MS = 30_000;
/** The only audio FFmpeg's ipod muxer accepts; an MP4 can also carry MP3, MP2, Opus, FLAC and E-AC-3. */
const IPOD_MUXER_AUDIO_CODECS = new Set(['aac', 'alac', 'ac3']);
const MP4_MUXER = 'mp4';

interface ProbedStream {
  codecType: string | null;
  codecName: string | null;
}

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
  /**
   * A run hands every track of a book the same cover buffer, so the JPEG conversion is done once
   * per buffer rather than once per track. Keyed weakly, the result goes when the run's buffer does.
   */
  private readonly normalizedCovers = new WeakMap<Buffer, Promise<Buffer>>();

  async embedMetadata(filePath: string, format: string, input: AudioMetadataWriteInput): Promise<void> {
    const dir = dirname(filePath);
    const id = randomUUID();
    const coverPath = input.coverBytes ? join(dir, `.bookorbit-cover-${id}.jpg`) : null;
    const tempPath = join(dir, `.bookorbit-write-${id}.${format.toLowerCase()}`);

    try {
      if (coverPath && input.coverBytes) {
        await writeFile(coverPath, await this.normalizedCover(input.coverBytes));
      }
      const streams = isMp4Format(format) ? await probeStreams(filePath) : null;
      const useMp4MetadataTags = shouldUseMp4MetadataTags(format, coverPath, streams);
      const muxer = outputMuxer(format, streams);
      const ffmpegArgs = (outputFormat: string | undefined) =>
        buildFfmpegArgs(filePath, coverPath, tempPath, format, input.metadata, { useMp4MetadataTags, muxer: outputFormat });
      try {
        await runFfmpeg(resolveFfmpegPath(), ffmpegArgs(muxer));
      } catch (error) {
        // Unprobed, the file may hold audio the ipod muxer refuses, such as MP3; the mp4 muxer takes any of
        // it. A stalled write is not a muxer refusal, and a second attempt would only double the wait.
        if (!isMp4Format(format) || streams || error instanceof FfmpegStalledError) throw error;
        await runFfmpeg(resolveFfmpegPath(), ffmpegArgs(MP4_MUXER)).catch(() => {
          throw error;
        });
      }
      if (isMp4Format(format) && !useMp4MetadataTags) {
        await writeMp4FreeformTags(tempPath, mp4FreeformTags(input.metadata), { carryOverFrom: filePath });
      }
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

  private normalizedCover(coverBytes: Buffer): Promise<Buffer> {
    const cached = this.normalizedCovers.get(coverBytes);
    if (cached) return cached;

    const pending = normalizeCoverJpeg(coverBytes);
    this.normalizedCovers.set(coverBytes, pending);
    pending.catch(() => this.normalizedCovers.delete(coverBytes));
    return pending;
  }
}

function buildFfmpegArgs(
  filePath: string,
  coverPath: string | null,
  tempPath: string,
  format: string,
  metadata: AudioMetadataArg[],
  options?: { useMp4MetadataTags?: boolean; muxer?: string },
): string[] {
  const args = ['-v', 'error', '-y', '-i', filePath];

  if (coverPath) {
    args.push('-i', coverPath, '-map', '0:a', '-map', '0:s?', '-map', '1:v:0');
  } else {
    // Data streams are never copied: an M4B chapter track cannot be stream-copied into a new MP4, which
    // failed every tag-only write of an audiobook with chapters. -map_chapters rebuilds that track.
    args.push('-map', '0:a', '-map', '0:v?', '-map', '0:s?');
  }

  args.push('-map_metadata', '0', '-map_chapters', '0', '-c', 'copy');

  if (format.toLowerCase() === FORMAT_MP3) {
    args.push('-id3v2_version', '3');
  }

  for (const entry of metadata) {
    args.push(entry.specifier ? `-metadata:${entry.specifier}` : '-metadata', `${entry.key}=${entry.value}`);
  }

  const useMp4MetadataTags = options?.useMp4MetadataTags ?? (isMp4Format(format) && !coverPath);
  if (useMp4MetadataTags) {
    // ffmpeg drops MP4 covr artwork when use_metadata_tags is combined with an attached picture stream.
    args.push('-movflags', 'use_metadata_tags');
  }

  if (coverPath) {
    args.push('-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)');
  }

  if (options?.muxer) {
    args.push('-f', options.muxer);
  }

  args.push(tempPath);

  return args;
}

/** The tags FFmpeg's iTunes mode would drop, named upper case as iTunes-style taggers name freeform tags. */
function mp4FreeformTags(metadata: AudioMetadataArg[]): Mp4FreeformTag[] {
  return metadata
    .filter((entry) => !entry.specifier && !MP4_NATIVE_TAG_KEYS.has(entry.key))
    .map((entry) => ({ name: entry.key.toUpperCase(), value: entry.value }));
}

function isMp4Format(format: string): boolean {
  const normalized = format.toLowerCase();
  return normalized === FORMAT_M4B || normalized === FORMAT_M4A;
}

/** An unprobed file is treated as having art, which FFmpeg's iTunes mode would drop. */
function shouldUseMp4MetadataTags(format: string, coverPath: string | null, streams: ProbedStream[] | null): boolean {
  if (!isMp4Format(format) || coverPath || !streams) return false;
  return !streams.some((stream) => stream.codecType === 'video');
}

/**
 * FFmpeg picks the ipod muxer for an .m4b or .m4a name, and it rejects audio such as the MP3 an
 * Audiobookshelf merge stream-copies into an M4B. The mp4 muxer takes it; every other file keeps
 * the ipod muxer and its iTunes file type.
 */
function outputMuxer(format: string, streams: ProbedStream[] | null): string | undefined {
  if (!isMp4Format(format) || !streams) return undefined;
  const ipodRejectsAudio = streams.some((stream) => stream.codecType === 'audio' && !IPOD_MUXER_AUDIO_CODECS.has(stream.codecName ?? ''));
  return ipodRejectsAudio ? MP4_MUXER : undefined;
}

async function probeStreams(filePath: string): Promise<ProbedStream[] | null> {
  try {
    const { stdout } = await execFile(
      resolveFfprobePath(),
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', filePath],
      { timeout: FFPROBE_TIMEOUT_MS },
    );
    const parsed = JSON.parse(String(stdout)) as { streams?: Array<{ codec_type?: unknown; codec_name?: unknown }> };
    if (!Array.isArray(parsed.streams)) return null;
    return parsed.streams.map((stream) => ({
      codecType: typeof stream.codec_type === 'string' ? stream.codec_type : null,
      codecName: typeof stream.codec_name === 'string' ? stream.codec_name : null,
    }));
  } catch {
    return null;
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
  outputMuxer,
};
