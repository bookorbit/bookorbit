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

  it('does not accept a volume number from a client', async () => {
    expect(await errorsFor({ seriesName: 'Berserk', seriesIndex: '12', volumeIndex: '3' })).not.toEqual([]);
  });
});
