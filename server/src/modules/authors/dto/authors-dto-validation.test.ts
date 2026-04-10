import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthorMetadataProviderKey } from '@projectx/types';

import { BulkAuthorIdsDto } from './bulk-author-ids.dto';
import { DeleteAuthorsDto } from './delete-authors.dto';
import { ListAuthorBooksDto } from './list-author-books.dto';
import { ListAuthorInsightsDto } from './list-author-insights.dto';
import { ListAuthorMetadataDto } from './list-author-metadata.dto';
import { ListAuthorsDto } from './list-authors.dto';
import { ListDuplicateSuggestionsDto } from './list-duplicate-suggestions.dto';
import { LookupAuthorMetadataDto } from './lookup-author-metadata.dto';
import { MergeAuthorsDto } from './merge-authors.dto';
import { PreviewAuthorEnrichmentCountDto } from './preview-author-enrichment-count.dto';
import { UpdateAuthorDto } from './update-author.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto);
}

describe('Authors DTO validation', () => {
  it('validates bounded integer arrays for bulk and delete payloads', async () => {
    expect((await errorsFor(BulkAuthorIdsDto, { authorIds: [1, 2, 3] })).length).toBe(0);
    expect((await errorsFor(DeleteAuthorsDto, { authorIds: ['1', '2'] })).length).toBe(0);
    expect((await errorsFor(BulkAuthorIdsDto, { authorIds: [] })).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkAuthorIdsDto, { authorIds: Array.from({ length: 1001 }, () => 1) })).length).toBeGreaterThan(0);
    expect((await errorsFor(DeleteAuthorsDto, { authorIds: [0] })).length).toBeGreaterThan(0);
  });

  it('validates merge payload requirements and numeric coercion', async () => {
    expect((await errorsFor(MergeAuthorsDto, { targetAuthorId: '5', sourceAuthorIds: ['6', '7'] })).length).toBe(0);
    expect((await errorsFor(MergeAuthorsDto, { targetAuthorId: 0, sourceAuthorIds: [1] })).length).toBeGreaterThan(0);
    expect((await errorsFor(MergeAuthorsDto, { targetAuthorId: 1, sourceAuthorIds: [] })).length).toBeGreaterThan(0);
  });

  it('transforms and validates list-authors query options', async () => {
    const dto = plainToInstance(ListAuthorsDto, {
      q: 'dune',
      page: '1',
      size: '25',
      sort: 'bookCount',
      order: 'desc',
      libraryId: '3',
      hasPhoto: 'true',
      minBookCount: '2',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.size).toBe(25);
    expect(dto.libraryId).toBe(3);
    expect(dto.hasPhoto).toBe(true);
    expect(dto.minBookCount).toBe(2);

    expect((await errorsFor(ListAuthorsDto, { sort: 'invalid' })).length).toBeGreaterThan(0);
    expect((await errorsFor(ListAuthorsDto, { order: 'up' })).length).toBeGreaterThan(0);
  });

  it('validates books/insights/suggestion query boundaries', async () => {
    expect((await errorsFor(ListAuthorBooksDto, { page: '0', size: '50', sort: 'title', order: 'asc', libraryId: '1' })).length).toBe(0);
    expect((await errorsFor(ListAuthorInsightsDto, { libraryId: '1', windowDays: '30', limit: '10' })).length).toBe(0);
    expect((await errorsFor(ListDuplicateSuggestionsDto, { libraryId: '1', limit: '50', poolSize: '200', minConfidence: '0.8' })).length).toBe(0);

    expect((await errorsFor(ListAuthorBooksDto, { size: '101' })).length).toBeGreaterThan(0);
    expect((await errorsFor(ListAuthorInsightsDto, { windowDays: '366' })).length).toBeGreaterThan(0);
    expect((await errorsFor(ListDuplicateSuggestionsDto, { minConfidence: '0.1' })).length).toBeGreaterThan(0);
  });

  it('normalizes metadata provider query values and rejects unknown providers', async () => {
    const dto = plainToInstance(ListAuthorMetadataDto, {
      q: 'Jane Doe',
      providers: 'audnexus, audnexus',
      limit: '25',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.providers).toEqual(['audnexus', 'audnexus']);
    expect(dto.limit).toBe(25);

    const arrayProviders = plainToInstance(ListAuthorMetadataDto, {
      q: 'Jane Doe',
      providers: ['audnexus, audnexus', 'audnexus'],
    });
    const arrayErrors = await validate(arrayProviders);
    expect(arrayErrors).toHaveLength(0);
    expect(arrayProviders.providers).toEqual(['audnexus', 'audnexus', 'audnexus']);

    const invalidProvidersShape = plainToInstance(ListAuthorMetadataDto, {
      q: 'Jane Doe',
      providers: 123,
    });
    expect((await validate(invalidProvidersShape)).length).toBeGreaterThan(0);

    expect((await errorsFor(ListAuthorMetadataDto, { q: 'Jane', providers: 'invalid' })).length).toBeGreaterThan(0);
  });

  it('validates lookup and update payload constraints', async () => {
    expect((await errorsFor(LookupAuthorMetadataDto, { provider: AuthorMetadataProviderKey.AUDNEXUS, id: 'abc' })).length).toBe(0);
    expect((await errorsFor(UpdateAuthorDto, { name: 'Updated', sortName: null, description: 'Bio' })).length).toBe(0);

    expect((await errorsFor(LookupAuthorMetadataDto, { provider: 'invalid', id: 'abc' })).length).toBeGreaterThan(0);
    expect((await errorsFor(LookupAuthorMetadataDto, { provider: AuthorMetadataProviderKey.AUDNEXUS, id: '' })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateAuthorDto, { name: 'x'.repeat(501) })).length).toBeGreaterThan(0);
  });

  it('requires enrichment preview conditions and boolean flags', async () => {
    expect(
      (
        await errorsFor(PreviewAuthorEnrichmentCountDto, {
          conditions: { neverEnriched: true, missingBio: false, missingPhoto: true },
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(PreviewAuthorEnrichmentCountDto, {})).length).toBeGreaterThan(0);
    expect((await errorsFor(PreviewAuthorEnrichmentCountDto, { conditions: { neverEnriched: 'true' } })).length).toBeGreaterThan(0);
  });
});
