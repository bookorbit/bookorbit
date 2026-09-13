import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateAudiobookBookmarkDto } from './dto/create-audiobook-bookmark.dto';
import { PutAudiobookPlaybackStateDto } from './dto/put-audiobook-playback-state.dto';
import { UpdateAudiobookBookmarkDto } from './dto/update-audiobook-bookmark.dto';

async function errorsFor<T extends object>(type: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });
}

describe('Audiobook DTO validation', () => {
  it('accepts only the revision-controlled playback-state shape', async () => {
    const valid = {
      assetId: 'aud_11111111-1111-4111-8111-111111111111',
      positionMs: 12_345,
      capturedAt: '2026-02-01T00:00:00.000Z',
      operationId: '22222222-2222-4222-8222-222222222222',
      baseRevision: 3,
      manifestRevision: 'a'.repeat(64),
    };

    expect(await errorsFor(PutAudiobookPlaybackStateDto, valid)).toHaveLength(0);
    expect(await errorsFor(PutAudiobookPlaybackStateDto, { ...valid, positionMs: 12.5 })).not.toHaveLength(0);
    expect(await errorsFor(PutAudiobookPlaybackStateDto, { ...valid, assetId: '11' })).not.toHaveLength(0);
    expect(await errorsFor(PutAudiobookPlaybackStateDto, { ...valid, percentage: 50 })).not.toHaveLength(0);
  });

  it('validates dedicated audiobook bookmark create and update shapes', async () => {
    const create = {
      clientId: '33333333-3333-4333-8333-333333333333',
      positionMs: 50_000,
      chapterId: 'ch_1',
      title: 'A useful moment',
      note: 'Return here',
    };

    expect(await errorsFor(CreateAudiobookBookmarkDto, create)).toHaveLength(0);
    expect(await errorsFor(CreateAudiobookBookmarkDto, { ...create, title: '' })).not.toHaveLength(0);
    expect(await errorsFor(CreateAudiobookBookmarkDto, { ...create, positionSeconds: 50 })).not.toHaveLength(0);
    expect(await errorsFor(UpdateAudiobookBookmarkDto, { title: 'Renamed', note: null })).toHaveLength(0);
    expect(await errorsFor(UpdateAudiobookBookmarkDto, { title: '' })).not.toHaveLength(0);
  });
});
