import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReadingInsightsAccessHistoryQueryDto, SharedReadingInsightsQueryDto, UpdateReadingInsightsSharingDto } from './shared-reading-insights.dto';

describe('Shared reading insights DTOs', () => {
  it('accepts only explicit sharing levels', async () => {
    expect(await validate(plainToInstance(UpdateReadingInsightsSharingDto, { sharingLevel: 'detailed' }))).toEqual([]);
    expect((await validate(plainToInstance(UpdateReadingInsightsSharingDto, { sharingLevel: 'admin' }))).length).toBeGreaterThan(0);
  });

  it('bounds reporting periods and access-history pages', async () => {
    expect(await validate(plainToInstance(SharedReadingInsightsQueryDto, { days: '90' }))).toEqual([]);
    expect((await validate(plainToInstance(SharedReadingInsightsQueryDto, { days: 10000 }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(ReadingInsightsAccessHistoryQueryDto, { page: '2', pageSize: '20' }))).toEqual([]);
    expect((await validate(plainToInstance(ReadingInsightsAccessHistoryQueryDto, { pageSize: 1000 }))).length).toBeGreaterThan(0);
  });
});
