import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';

export function resolveFieldsWritten(payload: BookWritePayload, fieldMask?: Set<BookWritePayloadKey>): string[] {
  return (Object.keys(payload) as BookWritePayloadKey[]).filter((k) => {
    if (k === 'coverBytes') return false;
    if (fieldMask && !fieldMask.has(k)) return false;
    const v = payload[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}
