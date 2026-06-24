import { describe, expect, it } from 'vitest';

import type { UserBookStatusRow } from '../../db/schema';
import { deriveLifecycle } from './user-book-status.repository';
import type { SessionBoundaries } from './user-book-status.repository';

function makeRow(overrides: Partial<UserBookStatusRow> = {}): UserBookStatusRow {
  return {
    userId: 1,
    bookId: 10,
    status: 'reading',
    source: 'auto',
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    finishedAt: new Date('2024-02-01T00:00:00.000Z'),
    updatedAt: new Date('2024-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('deriveLifecycle', () => {
  const now = new Date('2025-01-15T12:00:00.000Z');
  const existingStarted = new Date('2024-04-01T10:00:00.000Z');
  const existingFinished = new Date('2024-08-01T10:00:00.000Z');
  const existing = makeRow({ startedAt: existingStarted, finishedAt: existingFinished, status: 'read' });

  it('clears both timestamps for unread and want_to_read', () => {
    expect(deriveLifecycle('unread', now, existing)).toEqual({ startedAt: null, finishedAt: null });
    expect(deriveLifecycle('want_to_read', now, existing)).toEqual({ startedAt: null, finishedAt: null });
  });

  it('initializes startedAt and clears finishedAt for active statuses', () => {
    for (const status of ['reading', 'on_hold', 'rereading'] as const) {
      expect(deriveLifecycle(status, now, null)).toEqual({ startedAt: now, finishedAt: null });
      expect(deriveLifecycle(status, now, existing)).toEqual({ startedAt: existingStarted, finishedAt: null });
    }
  });

  it('sets finishedAt to now for read and keeps existing startedAt', () => {
    expect(deriveLifecycle('read', now, null)).toEqual({ startedAt: now, finishedAt: now });
    expect(deriveLifecycle('read', now, existing)).toEqual({ startedAt: existingStarted, finishedAt: now });
  });

  it('clears stale finishedAt for skimmed and abandoned', () => {
    expect(deriveLifecycle('skimmed', now, existing)).toEqual({ startedAt: existingStarted, finishedAt: null });
    expect(deriveLifecycle('abandoned', now, existing)).toEqual({ startedAt: existingStarted, finishedAt: null });
  });

  it('initializes startedAt for skimmed and abandoned when missing', () => {
    const withoutStarted = makeRow({ startedAt: null, finishedAt: existingFinished, status: 'reading' });

    expect(deriveLifecycle('skimmed', now, withoutStarted)).toEqual({ startedAt: now, finishedAt: null });
    expect(deriveLifecycle('abandoned', now, withoutStarted)).toEqual({ startedAt: now, finishedAt: null });
  });
});

describe('deriveLifecycle with sessionBoundaries', () => {
  const now = new Date('2025-01-15T12:00:00.000Z');
  const firstSession = new Date('2024-03-01T08:00:00.000Z');
  const lastSession = new Date('2024-12-20T22:00:00.000Z');
  const boundaries: SessionBoundaries = { firstStartedAt: firstSession, lastEndedAt: lastSession };

  it('uses firstStartedAt from boundaries when existing is null', () => {
    expect(deriveLifecycle('reading', now, null, boundaries)).toEqual({ startedAt: firstSession, finishedAt: null });
  });

  it('uses firstStartedAt from boundaries when existing.startedAt is null', () => {
    const withNullStarted = makeRow({ startedAt: null, finishedAt: null, status: 'unread' });
    expect(deriveLifecycle('reading', now, withNullStarted, boundaries)).toEqual({ startedAt: firstSession, finishedAt: null });
  });

  it('does not override a non-null existing startedAt with boundaries', () => {
    const existingStarted = new Date('2024-01-01T00:00:00.000Z');
    const existing = makeRow({ startedAt: existingStarted, finishedAt: null, status: 'reading' });
    expect(deriveLifecycle('reading', now, existing, boundaries)).toEqual({ startedAt: existingStarted, finishedAt: null });
  });

  it('applies firstStartedAt for read status and still sets finishedAt to now', () => {
    expect(deriveLifecycle('read', now, null, boundaries)).toEqual({ startedAt: firstSession, finishedAt: now });
  });

  it('falls back to now when boundaries contain null timestamps', () => {
    const emptyBoundaries: SessionBoundaries = { firstStartedAt: null, lastEndedAt: null };
    expect(deriveLifecycle('reading', now, null, emptyBoundaries)).toEqual({ startedAt: now, finishedAt: null });
  });

  it('ignores boundaries for unread and want_to_read', () => {
    expect(deriveLifecycle('unread', now, null, boundaries)).toEqual({ startedAt: null, finishedAt: null });
    expect(deriveLifecycle('want_to_read', now, null, boundaries)).toEqual({ startedAt: null, finishedAt: null });
  });

  it('applies boundaries for all active statuses', () => {
    for (const status of ['reading', 'on_hold', 'rereading', 'skimmed', 'abandoned'] as const) {
      expect(deriveLifecycle(status, now, null, boundaries)).toEqual({ startedAt: firstSession, finishedAt: null });
    }
  });
});
