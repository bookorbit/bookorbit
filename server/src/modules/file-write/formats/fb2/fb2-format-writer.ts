import { Injectable } from '@nestjs/common';

import type { WriteResult } from '@bookorbit/types';
import { FORMAT_FB2 } from '../../file-write.constants';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import { writeFb2Metadata } from './fb2-write-core';

@Injectable()
export class Fb2FormatWriter implements FormatWriter {
  readonly format = FORMAT_FB2;

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const outcome = await writeFb2Metadata(filePath, payload, options.fieldMask, { dryRun: options.dryRun });

    if (outcome.status === 'skipped') {
      return { status: 'skipped', reason: outcome.reason, fieldsWritten: outcome.fieldsWritten, durationMs: Date.now() - start };
    }

    return { status: 'success', fieldsWritten: outcome.fieldsWritten, durationMs: Date.now() - start };
  }
}
