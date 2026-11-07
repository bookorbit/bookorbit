import { CanActivate, ExecutionContext, Injectable, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { STORY_EDIT_DATA_MAX_BYTES, STORY_EDITS_PAGE_MAX } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AppAttestGuard } from '../app-attest/app-attest.guard';
import { StoryEditsController } from './story-edits.controller';
import { StoryEditsService } from './story-edits.service';

const reader = { id: 7, username: 'reader', isSuperuser: false, permissions: [] } as unknown as RequestUser;
const EDIT_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';
const UPDATED_AT = '2026-11-06T10:15:30.250Z';

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: RequestUser }>().user = reader;
    return true;
  }
}

describe('StoryEditsController', () => {
  let app: NestFastifyApplication;
  const service = { list: vi.fn(), put: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StoryEditsController],
      providers: [
        { provide: StoryEditsService, useValue: service },
        { provide: APP_GUARD, useClass: StubAuthGuard },
      ],
    })
      .overrideGuard(AppAttestGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    service.list.mockReset().mockResolvedValue({ edits: [], cursor: '0', hasMore: false });
    service.put
      .mockReset()
      .mockImplementation((_bookId: number, id: string, _user: RequestUser, dto: Record<string, unknown>) => Promise.resolve({ id, ...dto }));
  });

  const put = (payload: unknown, id = EDIT_ID) => app.inject({ method: 'PUT', url: `/mobile/books/5/story-edits/${id}`, payload: payload as object });
  const get = (query = '') => app.inject({ method: 'GET', url: `/mobile/books/5/story-edits${query}` });
  const valid = { kind: 'merge', data: { from: 'Strider', into: 'Aragorn' }, position: 0.42, updatedAt: UPDATED_AT, deleted: false };

  it('declares its guard on the controller, covering both routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StoryEditsController)).toContain(AppAttestGuard);
  });

  describe('GET', () => {
    it('passes the book, the signed-in reader and the cursor to the service', async () => {
      const response = await get('?since=41&limit=50');

      expect(response.statusCode).toBe(200);
      expect(service.list).toHaveBeenCalledWith(5, reader, { since: '41', limit: 50 });
    });

    it('reads from the start when since is absent or empty', async () => {
      expect((await get()).statusCode).toBe(200);
      expect((await get('?since=')).statusCode).toBe(200);
      expect(service.list).toHaveBeenNthCalledWith(1, 5, reader, {});
      expect(service.list).toHaveBeenNthCalledWith(2, 5, reader, { since: '' });
    });

    it.each([
      ['a cursor that is not a revision', '?since=abc'],
      ['a negative cursor', '?since=-1'],
      ['a cursor with leading zeros', '?since=007'],
      ['a limit of zero', '?limit=0'],
      ['a limit over the page size', `?limit=${STORY_EDITS_PAGE_MAX + 1}`],
      ['a fractional limit', '?limit=2.5'],
      ['an unknown parameter', '?after=3'],
    ])('refuses %s with a 400', async (_label, query) => {
      expect((await get(query)).statusCode).toBe(400);
      expect(service.list).not.toHaveBeenCalled();
    });

    it('refuses a book id that is not an integer', async () => {
      expect((await app.inject({ method: 'GET', url: '/mobile/books/abc/story-edits' })).statusCode).toBe(400);
    });
  });

  describe('PUT', () => {
    it('passes a valid write through and answers 200', async () => {
      const response = await put(valid);

      expect(response.statusCode).toBe(200);
      expect(service.put).toHaveBeenCalledWith(5, EDIT_ID, reader, valid);
    });

    it('accepts the optional fields absent, a null position, and an uppercase id', async () => {
      expect((await put({ kind: 'note', data: {}, updatedAt: UPDATED_AT })).statusCode).toBe(200);
      expect((await put({ ...valid, position: null }, EDIT_ID.toUpperCase())).statusCode).toBe(200);
      expect((await put({ ...valid, position: 0 })).statusCode).toBe(200);
      expect((await put({ ...valid, position: 1 })).statusCode).toBe(200);
    });

    it('keeps free-form keys nested inside data, at every depth', async () => {
      const data = {
        names: ['Strider', 'Aragorn'],
        nested: { anyKey: { deeper: [1, null, true, { 'with space': 'x', ÜNICODE: '名' }] } },
        empty: {},
      };

      const response = await put({ ...valid, data });

      expect(response.statusCode).toBe(200);
      expect(service.put.mock.calls[0]![3].data).toEqual(data);
    });

    it('accepts data of exactly the size limit, counted in UTF-8 bytes', async () => {
      const overhead = JSON.stringify({ v: '' }).length;
      const atLimit = { v: 'a'.repeat(STORY_EDIT_DATA_MAX_BYTES - overhead) };
      expect((await put({ ...valid, data: atLimit })).statusCode).toBe(200);

      const multiByte = { v: 'é'.repeat((STORY_EDIT_DATA_MAX_BYTES - overhead) / 2 + 1) };
      expect(JSON.stringify(multiByte).length).toBeLessThan(STORY_EDIT_DATA_MAX_BYTES);
      expect((await put({ ...valid, data: multiByte })).statusCode).toBe(400);
    });

    it.each([
      ['an unknown top-level field', { ...valid, revision: 3 }, 'revision'],
      ['a missing kind', { data: {}, updatedAt: UPDATED_AT }, 'kind'],
      ['an empty kind', { ...valid, kind: '' }, 'kind'],
      ['a kind starting with a capital', { ...valid, kind: 'Merge' }, 'kind'],
      ['a kind starting with a digit', { ...valid, kind: '1merge' }, 'kind'],
      ['a kind with a space', { ...valid, kind: 'merge names' }, 'kind'],
      ['a kind over the length limit', { ...valid, kind: `k${'a'.repeat(32)}` }, 'kind'],
      ['a kind that is not a string', { ...valid, kind: 3 }, 'kind'],
      ['array data', { ...valid, data: ['Strider'] }, 'data'],
      ['null data', { ...valid, data: null }, 'data'],
      ['string data', { ...valid, data: 'Strider' }, 'data'],
      ['missing data', { kind: 'merge', updatedAt: UPDATED_AT }, 'data'],
      ['oversized data', { ...valid, data: { v: 'a'.repeat(STORY_EDIT_DATA_MAX_BYTES) } }, 'data'],
      ['data holding a NUL character', { ...valid, data: { v: 'a\u0000b' } }, 'data'],
      ['data holding an unpaired surrogate', { ...valid, data: { v: '\uD800' } }, 'data'],
      ['a position below 0', { ...valid, position: -0.01 }, 'position'],
      ['a position above 1', { ...valid, position: 1.01 }, 'position'],
      ['a position that is a string', { ...valid, position: '0.5' }, 'position'],
      ['a missing updatedAt', { kind: 'merge', data: {} }, 'updatedAt'],
      ['an updatedAt that is not a date', { ...valid, updatedAt: 'yesterday' }, 'updatedAt'],
      ['an impossible calendar date', { ...valid, updatedAt: '2026-02-30T10:00:00Z' }, 'updatedAt'],
      ['a deleted flag that is not a boolean', { ...valid, deleted: 'yes' }, 'deleted'],
    ])('refuses %s with a 400 naming the field', async (_label, payload, field) => {
      const response = await put(payload);

      expect(response.statusCode).toBe(400);
      expect(JSON.stringify(response.json())).toContain(field);
      expect(service.put).not.toHaveBeenCalled();
    });

    it('refuses an id that is not a UUID', async () => {
      expect((await put(valid, 'not-a-uuid')).statusCode).toBe(400);
      expect(service.put).not.toHaveBeenCalled();
    });
  });
});
