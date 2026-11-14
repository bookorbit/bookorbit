import type { WriteResult } from '@bookorbit/types';
import type { BookWritePayload } from './book-write-payload.interface';
import type { FormatWriteOptions } from './format-write-options.interface';

export const FORMAT_WRITERS = Symbol('FORMAT_WRITERS');

/** What a writer reports when the file already holds the audiobook cover it was asked to embed. */
export const AUDIO_COVER_UNCHANGED_REASON = 'audio cover unchanged';

export interface AudioCoverEmbedOptions {
  dryRun: boolean;
  /** Runs once the file is known to change, just before it is replaced. Not run for a dry run or an unchanged cover. */
  beforeWrite?: () => Promise<void>;
}

export interface FormatWriter {
  readonly format: string;
  write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult>;
  /** Only a container that can hold a square audiobook cover beside the book cover implements this. */
  embedAudioCover?(filePath: string, coverBytes: Buffer, options: AudioCoverEmbedOptions): Promise<WriteResult>;
}
