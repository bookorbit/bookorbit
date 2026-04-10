import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SaveReadingSessionDto } from './save-reading-session.dto';

describe('SaveReadingSessionDto', () => {
  it('accepts valid payloads including nullable progress fields', async () => {
    const dto = plainToInstance(SaveReadingSessionDto, {
      sessionId: 'session-1',
      startedAt: '2026-04-15T10:00:00.000Z',
      endedAt: '2026-04-15T10:02:00.000Z',
      durationSeconds: 120,
      progressDelta: null,
      endProgress: null,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it('rejects invalid session id and invalid progress bounds', async () => {
    const invalid = plainToInstance(SaveReadingSessionDto, {
      sessionId: '',
      startedAt: '2026-04-15T10:00:00.000Z',
      endedAt: '2026-04-15T10:02:00.000Z',
      durationSeconds: -1,
      progressDelta: 'bad',
      endProgress: 101,
    });

    const errors = await validate(invalid);
    expect(errors.length).toBeGreaterThan(0);
  });
});
