import type { WriteResult } from '@projectx/types';
import type { BookWritePayload } from './book-write-payload.interface';
import type { FormatWriteOptions } from './format-write-options.interface';

export const FORMAT_WRITERS = Symbol('FORMAT_WRITERS');

export interface FormatWriter {
  readonly format: string;
  write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult>;
}
