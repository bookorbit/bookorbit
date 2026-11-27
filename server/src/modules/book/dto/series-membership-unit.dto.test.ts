import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateBookMetadataDto } from './update-book-metadata.dto';

async function errorsFor(membership: Record<string, unknown>) {
  const dto = plainToInstance(UpdateBookMetadataDto, { seriesMemberships: [membership] });
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('series membership unit', () => {
  it('accepts a membership without a unit, as released clients send it', async () => {
    expect(await errorsFor({ seriesName: 'Berserk', seriesIndex: '12' })).toEqual([]);
  });

  it.each(['volume', 'chapter', 'issue', null])('accepts %s', async (unit) => {
    expect(await errorsFor({ seriesName: 'Berserk', seriesIndex: '12', unit })).toEqual([]);
  });

  it.each(['book', 'Volume', 3])('rejects %s', async (unit) => {
    expect(await errorsFor({ seriesName: 'Berserk', seriesIndex: '12', unit })).not.toEqual([]);
  });

  it.each(['3', '2.5', null])('accepts the run a chapter sits in: %s', async (volumeIndex) => {
    expect(await errorsFor({ seriesName: 'Berserk', seriesIndex: '12', unit: 'chapter', volumeIndex })).toEqual([]);
  });

  it.each(['v3', '-1', 3, ''])('rejects a run that is not a series number: %s', async (volumeIndex) => {
    expect(await errorsFor({ seriesName: 'Berserk', seriesIndex: '12', volumeIndex })).not.toEqual([]);
  });

  it('drops leading zeros so "02" and "2" are one run', () => {
    const dto = plainToInstance(UpdateBookMetadataDto, { seriesMemberships: [{ seriesName: 'Doom Patrol', volumeIndex: ' 02 ' }] });
    expect(dto.seriesMemberships?.[0]?.volumeIndex).toBe('2');
  });
});
