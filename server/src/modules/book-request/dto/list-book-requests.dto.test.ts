import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BOOK_REQUEST_LIST_VIEWS, BOOK_REQUEST_SEARCH_MAX_LENGTH } from '@bookorbit/types';

import { ListAllBookRequestsDto, ListBookRequestsDto } from './list-book-requests.dto';

describe('ListAllBookRequestsDto', () => {
  it('transforms requester and accepts every supported status and media kind', async () => {
    const dto = plainToInstance(ListAllBookRequestsDto, {
      requesterUserId: '42',
      status: 'needs_review',
      mediaKind: 'audiobook',
    });

    expect(dto.requesterUserId).toBe(42);
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects invalid requester, status, and media values', async () => {
    const dto = plainToInstance(ListAllBookRequestsDto, {
      requesterUserId: '0',
      status: 'active',
      mediaKind: 'movie',
    });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

describe('ListBookRequestsDto', () => {
  /**
   * The personal list has no requester filter. Accepting one and ignoring it answered "my requests
   * by somebody else" with the caller's own rows and no hint the filter had not applied, so the
   * field lives only on the admin list and `forbidNonWhitelisted` refuses it here.
   */
  it('is refused a requester filter under the pipe the app runs', async () => {
    const dto = plainToInstance(ListBookRequestsDto, { requesterUserId: '42' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.map((error) => error.property)).toContain('requesterUserId');
  });

  it('still accepts the filters the personal list does offer', async () => {
    const dto = plainToInstance(ListBookRequestsDto, { status: 'pending', mediaKind: 'ebook', selfServe: 'true' });

    expect(dto.selfServe).toBe(true);
    expect(await validate(dto)).toEqual([]);
  });
});

describe.each([
  ['ListBookRequestsDto', ListBookRequestsDto],
  ['ListAllBookRequestsDto', ListAllBookRequestsDto],
] as const)('%s search and view', (_name, Dto) => {
  it('trims the search and accepts every view', async () => {
    for (const view of BOOK_REQUEST_LIST_VIEWS) {
      const dto = plainToInstance(Dto, { q: '  Dune  ', view });

      expect(dto.q).toBe('Dune');
      expect(dto.view).toBe(view);
      expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    }
  });

  /** A cleared search box must ask for the whole list, not for the rows that match nothing. */
  it('treats a blank search as no search at all', async () => {
    const dto = plainToInstance(Dto, { q: '   ' });

    expect(dto.q).toBeUndefined();
    expect(await validate(dto)).toEqual([]);
  });

  it('refuses a view it does not know', async () => {
    const dto = plainToInstance(Dto, { view: 'archived' });

    expect((await validate(dto)).map((error) => error.property)).toEqual(['view']);
  });

  it('refuses a search longer than the limit, measured after trimming', async () => {
    const atLimit = plainToInstance(Dto, { q: ` ${'x'.repeat(BOOK_REQUEST_SEARCH_MAX_LENGTH)} ` });
    const overLimit = plainToInstance(Dto, { q: 'x'.repeat(BOOK_REQUEST_SEARCH_MAX_LENGTH + 1) });

    expect(await validate(atLimit)).toEqual([]);
    expect((await validate(overLimit)).map((error) => error.property)).toEqual(['q']);
  });

  it('refuses a repeated search parameter rather than picking one', async () => {
    const dto = plainToInstance(Dto, { q: ['Dune', 'Emma'] });

    expect((await validate(dto)).map((error) => error.property)).toEqual(['q']);
  });
});
