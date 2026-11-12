import { CanActivate, ExecutionContext, Injectable, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { STORY_GUIDE_FIX_DATA_MAX_BYTES, STORY_GUIDE_FIXES_PAGE_MAX } from '@bookorbit/types';

import type { RequestUser } from '../../../common/types/request-user';
import { AppAttestGuard } from '../../app-attest/app-attest.guard';
import { StoryGuideFixesController } from './story-guide-fixes.controller';
import { StoryGuideFixesService } from './story-guide-fixes.service';

const manager = { id: 7, username: 'manager', isSuperuser: true, permissions: [] } as unknown as RequestUser;
const FIX_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';
const UPDATED_AT = '2026-11-10T10:15:30.250Z';

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: RequestUser }>().user = manager;
    return true;
  }
}

describe('StoryGuideFixesController', () => {
  let app: NestFastifyApplication;
  const service = { list: vi.fn(), put: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StoryGuideFixesController],
      providers: [
        { provide: StoryGuideFixesService, useValue: service },
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
    service.list.mockReset().mockResolvedValue({ fixes: [], cursor: '0', hasMore: false, orphans: [], rematched: {} });
    service.put
      .mockReset()
      .mockImplementation((_fileId: number, id: string, _user: RequestUser, dto: Record<string, unknown>) => Promise.resolve({ id, ...dto }));
  });

  const target = { key: 'violetta', names: ['violetta', 'lady-violetta'] };
  const put = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/mobile/books/files/12/story-guide/fixes/${FIX_ID}`, payload: { target, updatedAt: UPDATED_AT, ...payload } });

  it('accepts every kind with the data applying it reads', async () => {
    const valid: Record<string, unknown>[] = [
      { kind: 'rename', data: { name: 'Vi' } },
      { kind: 'kind', data: { kind: 'place' } },
      { kind: 'guide-kind', data: { kind: 'group' } },
      { kind: 'merge', data: { into: { key: 'tom', names: [] } } },
      { kind: 'split', data: { name: 'the masked girl' } },
      { kind: 'hide', data: {} },
      { kind: 'line', data: { text: 'A thief', through: { s: 4, end: true } } },
      { kind: 'line', data: { text: 'A thief' }, from: { s: 9, o: 0 } },
      { kind: 'line-hide', data: { through: { s: 3, o: 11, q: 'The masked girl' } } },
      { kind: 'tie-hide', target: { key: 'tom|friend_of|tom-2', names: [] }, data: { a: ['tom'] } },
      { kind: 'tie-type', target: { key: 'violetta|loves|tom', names: [] }, data: { type: 'spouse_of' } },
      { kind: 'tie-add', data: { type: 'enemy_of', b: { key: 'tom', names: ['tom'] }, note: 'kept as given' }, from: { s: 9, o: 4 } },
    ];
    for (const payload of valid) expect({ payload, status: (await put(payload)).statusCode }).toEqual({ payload, status: 200 });
    expect(service.put).toHaveBeenLastCalledWith(12, FIX_ID, manager, expect.objectContaining({ from: { s: 9, o: 4 } }));
  });

  it('refuses data a kind cannot apply', async () => {
    const invalid: Record<string, unknown>[] = [
      { kind: 'note', data: {} },
      { kind: 'rename', data: {} },
      { kind: 'rename', data: { name: 'x'.repeat(201) } },
      { kind: 'kind', data: { kind: 'group' } },
      { kind: 'guide-kind', data: { kind: 'person' } },
      { kind: 'merge', data: { into: 'tom' } },
      { kind: 'line', data: { text: 'No place to start' } },
      { kind: 'line', data: { text: 'A thief', through: { s: 4 } } },
      { kind: 'line-hide', data: {} },
      { kind: 'tie-hide', data: {} },
      { kind: 'tie-type', target: { key: 'violetta|loves|tom', names: [] }, data: { type: 'nemesis_of' } },
      { kind: 'tie-add', data: { type: 'enemy_of' } },
      { kind: 'hide', data: { blob: 'x'.repeat(STORY_GUIDE_FIX_DATA_MAX_BYTES) } },
      { kind: 'hide', data: [] },
    ];
    for (const payload of invalid) expect({ payload, status: (await put(payload)).statusCode }).toEqual({ payload, status: 400 });
    expect(service.put).not.toHaveBeenCalled();
  });

  it('is strict about the target, the position and the body', async () => {
    for (const payload of [
      { kind: 'hide', data: {}, target: { key: 'violetta', names: [], extra: 1 } },
      { kind: 'hide', data: {}, target: { key: 'violetta' } },
      { kind: 'hide', data: {}, from: { s: 1, o: 2, q: 'x' } },
      { kind: 'hide', data: {}, from: { s: -1, o: 0 } },
      { kind: 'hide', data: {}, position: 0.5 },
      { kind: 'hide', data: {}, updatedAt: 'yesterday' },
    ]) {
      expect({ payload, status: (await put(payload)).statusCode }).toEqual({ payload, status: 400 });
    }
    expect(
      (await app.inject({ method: 'PUT', url: '/mobile/books/files/12/story-guide/fixes/not-a-uuid', payload: { kind: 'hide' } })).statusCode,
    ).toBe(400);
  });

  it('takes a delete with no data a kind would read', async () => {
    expect((await put({ kind: 'line', data: {}, deleted: true })).statusCode).toBe(200);
    expect((await put({ kind: 'tie-type', data: {}, deleted: true })).statusCode).toBe(200);
  });

  it('pages by cursor within the page bound', async () => {
    expect((await app.inject({ method: 'GET', url: '/mobile/books/files/12/story-guide/fixes?since=41&limit=5' })).statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(12, manager, { since: '41', limit: 5 });
    for (const query of ['since=abc', `limit=${STORY_GUIDE_FIXES_PAGE_MAX + 1}`, 'limit=0', 'other=1']) {
      expect((await app.inject({ method: 'GET', url: `/mobile/books/files/12/story-guide/fixes?${query}` })).statusCode).toBe(400);
    }
  });
});
