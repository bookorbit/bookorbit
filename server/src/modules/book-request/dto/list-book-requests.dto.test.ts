import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
