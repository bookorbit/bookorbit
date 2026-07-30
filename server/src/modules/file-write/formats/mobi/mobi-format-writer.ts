import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';

import type { WriteResult } from '@bookorbit/types';
import { FORMAT_AZW, FORMAT_AZW3, FORMAT_MOBI, KINDLE_WRITE_FORMATS } from '../../file-write.constants';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { writeMobiMetadata } from './mobi-write-core';

export class MobiFormatWriter implements FormatWriter {
  private readonly logger = new Logger(MobiFormatWriter.name);

  constructor(readonly format: (typeof KINDLE_WRITE_FORMATS)[number]) {}

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();

    const source = await readFile(filePath);
    const outcome = await writeMobiMetadata(source, payload, options.fieldMask);

    if (outcome.fieldsWritten.length === 0) {
      return { status: 'skipped', reason: 'no metadata to write', fieldsWritten: [], durationMs: Date.now() - start };
    }

    if (options.dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten: outcome.fieldsWritten, durationMs: Date.now() - start };
    }

    if (outcome.lossyChars > 0) {
      this.logger.warn(
        `[mobi-write] [end] format=${this.format} lossyChars=${outcome.lossyChars} path="${sanitizeLogValue(filePath)}" - characters replaced because the file encoding cannot represent them`,
      );
    }

    const tempPath = join(dirname(filePath), `.mobi-write-${randomUUID()}`);
    await writeFile(tempPath, outcome.buffer);
    await replaceFileAtomically(tempPath, filePath);

    return { status: 'success', fieldsWritten: outcome.fieldsWritten, durationMs: Date.now() - start };
  }
}

@Injectable()
export class MobiEbookFormatWriter extends MobiFormatWriter {
  constructor() {
    super(FORMAT_MOBI);
  }
}

@Injectable()
export class Azw3FormatWriter extends MobiFormatWriter {
  constructor() {
    super(FORMAT_AZW3);
  }
}

@Injectable()
export class AzwFormatWriter extends MobiFormatWriter {
  constructor() {
    super(FORMAT_AZW);
  }
}
