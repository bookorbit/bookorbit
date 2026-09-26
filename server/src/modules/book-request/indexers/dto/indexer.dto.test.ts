import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { CreateIndexerDto, UpdateIndexerDto } from './indexer.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const create = { name: 'Source', adapterType: 'torznab', baseUrl: 'https://indexer.example' };

async function validate<T extends CreateIndexerDto | UpdateIndexerDto>(type: new () => T, value: unknown): Promise<T> {
  return pipe.transform(value, { type: 'body', metatype: type }) as Promise<T>;
}

describe.each([CreateIndexerDto, UpdateIndexerDto])('%s seed policy validation', (Dto) => {
  const base = Dto === CreateIndexerDto ? create : {};

  it('accepts null clears and the numeric boundaries', async () => {
    await expect(
      validate(Dto, {
        ...base,
        applyTrackerSeedGoals: false,
        seedRatioGoal: 0.0001,
        seedTimeMinutes: 2_147_483_647,
      }),
    ).resolves.toBeDefined();
    await expect(validate(Dto, { ...base, seedRatioGoal: null, seedTimeMinutes: null })).resolves.toBeDefined();
  });

  it.each([
    { seedRatioGoal: 0 },
    { seedRatioGoal: -1 },
    { seedRatioGoal: '1.5' },
    { seedRatioGoal: Number.NaN },
    { seedRatioGoal: Number.POSITIVE_INFINITY },
    { seedTimeMinutes: 1.5 },
    { seedTimeMinutes: 0 },
    { seedTimeMinutes: -1 },
    { seedTimeMinutes: '60' },
    { seedTimeMinutes: 2_147_483_648 },
    { applyTrackerSeedGoals: null },
    { applyTrackerSeedGoals: 'false' },
    { applyTrackerSeedGoals: 0 },
  ])('rejects invalid input %j', async (invalid) => {
    await expect(validate(Dto, { ...base, ...invalid })).rejects.toBeInstanceOf(BadRequestException);
  });
});
