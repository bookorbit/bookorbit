import type { BookWritePayloadKey } from './book-write-payload.interface';

export interface FormatWriteOptions {
  fieldMask: Set<BookWritePayloadKey>;
  dryRun: boolean;
}
