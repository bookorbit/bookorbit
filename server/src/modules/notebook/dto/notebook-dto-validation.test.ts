import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { NOTEBOOK_BOOKS_PAGE_SIZE_MAX, NOTEBOOK_PAGE_SIZE_MAX, NOTEBOOK_SEARCH_MAX_LENGTH } from '@bookorbit/types';

import {
  NotebookBooksQueryDto,
  NotebookEntriesQueryDto,
  NotebookOnThisDayQueryDto,
  NotebookOverviewQueryDto,
  NotebookReviewQueryDto,
  NotebookTrashQueryDto,
} from './notebook-query.dto';

async function check<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors };
}

describe('NotebookEntriesQueryDto', () => {
  it('accepts an empty query', async () => {
    expect((await check(NotebookEntriesQueryDto, {})).errors).toHaveLength(0);
  });

  it('converts query-string booleans, so false means no filter rather than true', async () => {
    const { dto, errors } = await check(NotebookEntriesQueryDto, { starred: 'true', hasNote: 'false', approximate: 'false' });
    expect(errors).toHaveLength(0);
    expect(dto.starred).toBe(true);
    expect(dto.hasNote).toBe(false);
    expect(dto.approximate).toBe(false);
  });

  it('rejects anything else as a boolean', async () => {
    expect((await check(NotebookEntriesQueryDto, { starred: '1' })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { hasNote: 'yes' })).errors).toHaveLength(1);
  });

  it('parses comma and repeated lists for kinds and origins', async () => {
    const { dto, errors } = await check(NotebookEntriesQueryDto, { kinds: 'highlight, review,highlight', origins: ['kobo', 'web,kobo'] });
    expect(errors).toHaveLength(0);
    expect(dto.kinds).toEqual(['highlight', 'review']);
    expect(dto.origins).toEqual(['kobo', 'web']);
  });

  it('rejects an unknown kind or origin', async () => {
    expect((await check(NotebookEntriesQueryDto, { kinds: 'highlight,podcast' })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { origins: 'web,apple' })).errors).toHaveLength(1);
  });

  it('bounds limit, q, colors, cursor and bookId', async () => {
    expect((await check(NotebookEntriesQueryDto, { limit: '0' })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { limit: String(NOTEBOOK_PAGE_SIZE_MAX + 1) })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { limit: 'ten' })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { q: 'x'.repeat(NOTEBOOK_SEARCH_MAX_LENGTH + 1) })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { colors: 'x'.repeat(301) })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { cursor: 'x'.repeat(513) })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { bookId: '0' })).errors).toHaveLength(1);
    expect((await check(NotebookEntriesQueryDto, { bookId: '2147483648' })).errors).toHaveLength(1);

    const { dto, errors } = await check(NotebookEntriesQueryDto, { limit: '100', bookId: '12', q: '  dune  ' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ limit: 100, bookId: 12, q: 'dune' });
  });

  it('accepts only the documented sorts', async () => {
    expect((await check(NotebookEntriesQueryDto, { sort: 'edited' })).errors).toHaveLength(0);
    expect((await check(NotebookEntriesQueryDto, { sort: 'random' })).errors).toHaveLength(1);
  });

  it('forbids unknown parameters', async () => {
    expect((await check(NotebookEntriesQueryDto, { page: '2' })).errors).toHaveLength(1);
  });
});

describe('NotebookOverviewQueryDto', () => {
  it('takes the filters but not kinds, sort, cursor or limit', async () => {
    expect((await check(NotebookOverviewQueryDto, { starred: 'true', colors: '#FACC15', q: 'x', bookId: '3' })).errors).toHaveLength(0);
    for (const extra of [{ kinds: 'highlight' }, { sort: 'newest' }, { cursor: 'abc' }, { limit: '5' }]) {
      expect((await check(NotebookOverviewQueryDto, extra)).errors).toHaveLength(1);
    }
  });
});

describe('NotebookBooksQueryDto', () => {
  it('bounds limit to the books page size', async () => {
    expect((await check(NotebookBooksQueryDto, { limit: String(NOTEBOOK_BOOKS_PAGE_SIZE_MAX) })).errors).toHaveLength(0);
    expect((await check(NotebookBooksQueryDto, { limit: String(NOTEBOOK_BOOKS_PAGE_SIZE_MAX + 1) })).errors).toHaveLength(1);
    expect((await check(NotebookBooksQueryDto, { starred: 'true' })).errors).toHaveLength(1);
  });
});

describe('NotebookReviewQueryDto', () => {
  it('accepts a calendar date or an integer seed with filters', async () => {
    expect((await check(NotebookReviewQueryDto, { date: '2028-02-29' })).errors).toHaveLength(0);
    const { dto, errors } = await check(NotebookReviewQueryDto, { seed: '-17', colors: 'blue', starred: 'true' });
    expect(errors).toHaveLength(0);
    expect(dto.seed).toBe(-17);
  });

  it('rejects impossible dates and non-integer seeds', async () => {
    expect((await check(NotebookReviewQueryDto, { date: '2026-02-29' })).errors).toHaveLength(1);
    expect((await check(NotebookReviewQueryDto, { date: '2026-1-5' })).errors).toHaveLength(1);
    expect((await check(NotebookReviewQueryDto, { seed: '1.5' })).errors).toHaveLength(1);
    expect((await check(NotebookReviewQueryDto, { seed: 'abc' })).errors).toHaveLength(1);
    expect((await check(NotebookReviewQueryDto, { kinds: 'journal', seed: '1' })).errors).toHaveLength(1);
  });
});

describe('NotebookOnThisDayQueryDto', () => {
  it('requires a date and validates the zone', async () => {
    expect((await check(NotebookOnThisDayQueryDto, {})).errors).toHaveLength(1);
    expect((await check(NotebookOnThisDayQueryDto, { date: '2026-10-04' })).errors).toHaveLength(0);
    expect((await check(NotebookOnThisDayQueryDto, { date: '2026-10-04', tz: 'Asia/Kolkata' })).errors).toHaveLength(0);
    expect((await check(NotebookOnThisDayQueryDto, { date: '2026-10-04', tz: 'Mars/Olympus' })).errors).toHaveLength(1);
    expect((await check(NotebookOnThisDayQueryDto, { date: '2026-10-04', tz: '' })).errors).toHaveLength(1);
  });
});

describe('NotebookTrashQueryDto', () => {
  it('takes a cursor and a limit only', async () => {
    expect((await check(NotebookTrashQueryDto, { cursor: 'abc', limit: '20' })).errors).toHaveLength(0);
    expect((await check(NotebookTrashQueryDto, { kinds: 'highlight' })).errors).toHaveLength(1);
  });
});
