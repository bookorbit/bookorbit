import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateManualReadingSessionDto } from './create-manual-reading-session.dto';

async function errorsFor(value: Record<string, unknown>) {
  return validate(plainToInstance(CreateManualReadingSessionDto, value));
}

describe('CreateManualReadingSessionDto', () => {
  it('accepts a minimal payload', async () => {
    expect(await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 30 })).toEqual([]);
  });

  it('accepts optional endProgress and format', async () => {
    expect(await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 30, endProgress: 55.5, format: 'EPUB' })).toEqual([]);
  });

  it('rejects a missing or malformed startedAt', async () => {
    expect((await errorsFor({ durationMinutes: 30 })).length).toBeGreaterThan(0);
    expect((await errorsFor({ startedAt: 'not-a-date', durationMinutes: 30 })).length).toBeGreaterThan(0);
  });

  it('rejects out-of-range durations', async () => {
    expect((await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 1441 })).length).toBeGreaterThan(0);
    expect((await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 12.5 })).length).toBeGreaterThan(0);
  });

  it('rejects out-of-range endProgress', async () => {
    expect((await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 30, endProgress: 101 })).length).toBeGreaterThan(0);
    expect((await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 30, endProgress: -1 })).length).toBeGreaterThan(0);
  });

  it('rejects an over-long format', async () => {
    expect((await errorsFor({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 30, format: 'x'.repeat(13) })).length).toBeGreaterThan(0);
  });
});
