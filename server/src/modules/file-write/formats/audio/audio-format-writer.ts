import { Injectable } from '@nestjs/common';

import { AUDIO_BOOK_FILE_WRITE_FIELDS, type WriteResult } from '@bookorbit/types';
import { AUDIO_WRITE_FORMATS, FORMAT_FLAC, FORMAT_M4A, FORMAT_M4B, FORMAT_MP3 } from '../../file-write.constants';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { AudioMetadataEmbedder, type AudioMetadataArg } from './audio-metadata-embedder';

type AudioBookFileWriteField = (typeof AUDIO_BOOK_FILE_WRITE_FIELDS)[number];
const AUDIO_WRITABLE_METADATA_FIELDS = AUDIO_BOOK_FILE_WRITE_FIELDS.filter(
  (field): field is Exclude<AudioBookFileWriteField, 'coverBytes'> => field !== 'coverBytes',
);

export class AudioFormatWriter implements FormatWriter {
  constructor(
    readonly format: (typeof AUDIO_WRITE_FORMATS)[number],
    private readonly embedder: AudioMetadataEmbedder,
  ) {}

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const metadata = buildAudioMetadataArgs(payload, options);
    const fieldsWritten = resolveFieldsWritten(payload, options, metadata);

    if (fieldsWritten.length === 0) {
      return { status: 'skipped', reason: 'no audio metadata to write', fieldsWritten: [], durationMs: Date.now() - start };
    }

    if (options.dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    await this.embedder.embedMetadata(filePath, this.format, {
      coverBytes: hasWritableCover(payload, options) ? payload.coverBytes : null,
      metadata,
    });
    return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
  }
}

@Injectable()
export class M4bAudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioMetadataEmbedder) {
    super(FORMAT_M4B, embedder);
  }
}

@Injectable()
export class M4aAudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioMetadataEmbedder) {
    super(FORMAT_M4A, embedder);
  }
}

@Injectable()
export class Mp3AudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioMetadataEmbedder) {
    super(FORMAT_MP3, embedder);
  }
}

@Injectable()
export class FlacAudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioMetadataEmbedder) {
    super(FORMAT_FLAC, embedder);
  }
}

function buildAudioMetadataArgs(payload: BookWritePayload, options: FormatWriteOptions): AudioMetadataArg[] {
  const metadata: AudioMetadataArg[] = [];

  if (canWriteField(payload, options, 'title')) {
    pushFormatMetadata(metadata, 'album', textValue(payload.title));
    pushFormatMetadata(metadata, 'title', options.isMultiTrackAudio ? textValue(options.trackTitle) : textValue(payload.title));
    if (options.isMultiTrackAudio && options.trackNumber && options.trackTotal) {
      pushFormatMetadata(metadata, 'track', `${options.trackNumber}/${options.trackTotal}`);
    }
  }

  if (canWriteField(payload, options, 'subtitle')) {
    pushFormatMetadata(metadata, 'subtitle', textValue(payload.subtitle));
  }

  if (canWriteField(payload, options, 'authors')) {
    const authors = joinPeople(payload.authors?.map((author) => author.name));
    pushFormatMetadata(metadata, 'album_artist', authors);
    pushFormatMetadata(metadata, 'albumartist', authors);
    pushFormatMetadata(metadata, 'artist', authors);
  }

  if (canWriteField(payload, options, 'narrators')) {
    pushFormatMetadata(metadata, 'composer', joinPeople(payload.narrators));
  }

  if (canWriteField(payload, options, 'publishedYear')) {
    const date = payload.publishedDate ?? (payload.publishedYear == null ? '' : String(payload.publishedYear));
    const year = payload.publishedYear == null ? '' : String(payload.publishedYear);
    pushFormatMetadata(metadata, 'date', date);
    pushFormatMetadata(metadata, 'year', year);
  } else if (canWriteField(payload, options, 'publishedDate')) {
    pushFormatMetadata(metadata, 'date', payload.publishedDate ?? '');
  }

  if (canWriteField(payload, options, 'publisher')) {
    pushFormatMetadata(metadata, 'publisher', textValue(payload.publisher));
  }

  if (canWriteField(payload, options, 'description')) {
    const description = textValue(payload.description);
    pushFormatMetadata(metadata, 'description', description);
    pushFormatMetadata(metadata, 'comment', description);
  }

  if (canWriteField(payload, options, 'genres')) {
    pushFormatMetadata(metadata, 'genre', joinList(payload.genres));
  }

  if (canWriteField(payload, options, 'language')) {
    const language = textValue(payload.language);
    pushFormatMetadata(metadata, 'language', language);
    pushStreamMetadata(metadata, 's:a:0', 'language', language);
  }

  if (canWriteField(payload, options, 'seriesName')) {
    pushFormatMetadata(metadata, 'series', textValue(payload.seriesName));
  }

  if (canWriteField(payload, options, 'seriesIndex')) {
    pushFormatMetadata(metadata, 'series-part', payload.seriesIndex == null ? '' : String(payload.seriesIndex));
  }

  if (canWriteField(payload, options, 'audibleId')) {
    const audibleId = textValue(payload.audibleId);
    pushFormatMetadata(metadata, 'asin', audibleId);
    pushFormatMetadata(metadata, 'audible_asin', audibleId);
  }

  if (canWriteField(payload, options, 'librofmId')) {
    pushFormatMetadata(metadata, 'librofm_isbn', textValue(payload.librofmId));
  }

  return metadata;
}

function resolveFieldsWritten(payload: BookWritePayload, options: FormatWriteOptions, metadata: AudioMetadataArg[]): string[] {
  const fieldsWritten: string[] = [];

  for (const field of AUDIO_WRITABLE_METADATA_FIELDS) {
    if (canWriteField(payload, options, field)) {
      fieldsWritten.push(field);
    }
  }

  if (metadata.some((entry) => entry.key === 'track')) {
    fieldsWritten.push('track');
  }

  if (hasWritableCover(payload, options)) {
    fieldsWritten.push('coverBytes');
  }

  return fieldsWritten;
}

function canWriteField<K extends AudioBookFileWriteField>(payload: BookWritePayload, options: FormatWriteOptions, key: K): boolean {
  return options.fieldMask.has(key) && Object.prototype.hasOwnProperty.call(payload, key);
}

function hasWritableCover(payload: BookWritePayload, options: FormatWriteOptions): payload is BookWritePayload & { coverBytes: Buffer } {
  return options.fieldMask.has('coverBytes') && Buffer.isBuffer(payload.coverBytes);
}

function pushFormatMetadata(metadata: AudioMetadataArg[], key: string, value: string): void {
  metadata.push({ key, value });
}

function pushStreamMetadata(metadata: AudioMetadataArg[], specifier: string, key: string, value: string): void {
  metadata.push({ key, value, specifier });
}

function textValue(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function joinPeople(values: string[] | undefined): string {
  return joinList(values);
}

function joinList(values: string[] | undefined): string {
  return (
    values
      ?.map((value) => value.trim())
      .filter(Boolean)
      .join('; ') ?? ''
  );
}

export const testing = {
  buildAudioMetadataArgs,
};
