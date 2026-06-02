import { Injectable } from '@nestjs/common';

import type { WriteResult } from '@bookorbit/types';
import { AUDIO_WRITE_FORMATS, FORMAT_FLAC, FORMAT_M4A, FORMAT_M4B, FORMAT_MP3 } from '../../file-write.constants';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { AudioCoverEmbedder } from './audio-cover-embedder';

export class AudioFormatWriter implements FormatWriter {
  constructor(
    readonly format: (typeof AUDIO_WRITE_FORMATS)[number],
    private readonly embedder: AudioCoverEmbedder,
  ) {}

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const fieldsWritten = payload.coverBytes && options.fieldMask.has('coverBytes') ? ['coverBytes'] : [];

    if (fieldsWritten.length === 0) {
      return { status: 'skipped', reason: 'no audio cover to write', fieldsWritten: [], durationMs: Date.now() - start };
    }

    if (options.dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    await this.embedder.embedCover(filePath, payload.coverBytes!, this.format);
    return { status: 'success', fieldsWritten, durationMs: Date.now() - start };
  }
}

@Injectable()
export class M4bAudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioCoverEmbedder) {
    super(FORMAT_M4B, embedder);
  }
}

@Injectable()
export class M4aAudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioCoverEmbedder) {
    super(FORMAT_M4A, embedder);
  }
}

@Injectable()
export class Mp3AudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioCoverEmbedder) {
    super(FORMAT_MP3, embedder);
  }
}

@Injectable()
export class FlacAudioFormatWriter extends AudioFormatWriter {
  constructor(embedder: AudioCoverEmbedder) {
    super(FORMAT_FLAC, embedder);
  }
}
