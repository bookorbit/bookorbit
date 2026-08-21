import type { ReadStatus, ReadStatusSource } from '@bookorbit/types';

export const READ_STATUSES: readonly ReadStatus[] = ['unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned'];

export const READ_STATUS_SOURCES: readonly ReadStatusSource[] = ['auto', 'manual'];

export const READING_DATE_ERROR_CODES = {
  invalidOrder: 'READING_DATES_INVALID_ORDER',
  startedInFuture: 'READING_DATE_STARTED_IN_FUTURE',
  finishedInFuture: 'READING_DATE_FINISHED_IN_FUTURE',
  statusConflict: 'READING_DATES_STATUS_CONFLICT',
} as const;

const READ_STATUS_SET = new Set<ReadStatus>(READ_STATUSES);
const READ_STATUS_SOURCE_SET = new Set<ReadStatusSource>(READ_STATUS_SOURCES);

export function isReadStatus(value: string): value is ReadStatus {
  return READ_STATUS_SET.has(value as ReadStatus);
}

export function isReadStatusSource(value: string): value is ReadStatusSource {
  return READ_STATUS_SOURCE_SET.has(value as ReadStatusSource);
}
