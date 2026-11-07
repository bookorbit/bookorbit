import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import type { CallHandler } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { IsArray, IsInt, IsOptional } from 'class-validator';
import { firstValueFrom, of } from 'rxjs';

import { BookAliasService } from '../../modules/book-alias/book-alias.service';
import { BookService } from '../../modules/book/book.service';
import { ResolvesMergedBook } from '../decorators/resolves-merged-book.decorator';
import { MergedBookAliasInterceptor } from './merged-book-alias.interceptor';

const ALIASES = new Map([
  [5, 9],
  [6, 9],
  [7, 12],
]);
const HIDDEN_FROM_SIGNED_IN_USER = 12;

const paramsSeenByGuard: unknown[] = [];

@Injectable()
class RecordingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ params?: Record<string, unknown>; headers: Record<string, string>; user?: unknown }>();
    paramsSeenByGuard.push(req.params?.bookId);
    if (req.headers['x-signed-in']) req.user = { id: 23 };
    return true;
  }
}

class BookIdsDto {
  @IsOptional()
  @IsInt()
  bookId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  bookIds?: number[];
}

@Controller('alias-test')
class AliasTestController {
  @ResolvesMergedBook({ params: ['bookId'] })
  @Get('parsed/:bookId')
  parsed(@Param('bookId', ParseIntPipe) bookId: number) {
    return { bookId };
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Get('raw/:bookId')
  raw(@Param('bookId') bookId: string) {
    return { bookId, type: typeof bookId };
  }

  @Get('undecorated/:bookId')
  undecorated(@Param('bookId', ParseIntPipe) bookId: number) {
    return { bookId };
  }

  @ResolvesMergedBook({ body: ['bookId', 'bookIds'] })
  @Post('dto')
  dto(@Body() dto: BookIdsDto) {
    return dto;
  }

  @ResolvesMergedBook({ body: ['bookId', 'bookIds'] })
  @Post('untyped')
  untyped(@Body() body: Record<string, unknown>) {
    return { body, bookIdType: typeof body.bookId };
  }
}

describe('MergedBookAliasInterceptor', () => {
  let app: NestFastifyApplication;
  const bookAlias = {
    resolve: vi.fn((ids: number[]) => Promise.resolve(new Map(ids.filter((id) => ALIASES.has(id)).map((id) => [id, ALIASES.get(id)!])))),
  };
  const bookService = {
    verifyBookAccess: vi.fn((bookId: number) =>
      bookId === HIDDEN_FROM_SIGNED_IN_USER ? Promise.reject(new NotFoundException(`Book ${bookId} not found`)) : Promise.resolve(),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AliasTestController],
      providers: [
        { provide: BookAliasService, useValue: bookAlias },
        { provide: BookService, useValue: bookService },
        { provide: APP_GUARD, useClass: RecordingGuard },
        { provide: APP_INTERCEPTOR, useClass: MergedBookAliasInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    bookAlias.resolve.mockClear();
    bookService.verifyBookAccess.mockClear();
    paramsSeenByGuard.length = 0;
  });

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });

  it('rewrites a merged-away route param after guards and before ParseIntPipe', async () => {
    const response = await get('/alias-test/parsed/5');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bookId: 9 });
    expect(paramsSeenByGuard).toEqual(['5']);
    expect(bookAlias.resolve).toHaveBeenCalledWith([5]);
  });

  it('rewrites for a signed-in caller who can see the kept book', async () => {
    expect((await get('/alias-test/parsed/5', { 'x-signed-in': '1' })).json()).toEqual({ bookId: 9 });
    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(9, { id: 23 });
  });

  it('keeps the old id for a signed-in caller who cannot see the kept book, so its 404 never names it', async () => {
    expect((await get('/alias-test/parsed/7', { 'x-signed-in': '1' })).json()).toEqual({ bookId: 7 });
    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(12, { id: 23 });
  });

  it('writes a param back as a string, the type it arrived as', async () => {
    expect((await get('/alias-test/raw/7')).json()).toEqual({ bookId: '12', type: 'string' });
  });

  it('leaves an id that was never merged alone', async () => {
    expect((await get('/alias-test/parsed/77')).json()).toEqual({ bookId: 77 });
    expect(bookAlias.resolve).toHaveBeenCalledWith([77]);
  });

  it('never looks up a value that is not a positive integer', async () => {
    expect((await get('/alias-test/raw/abc')).json()).toEqual({ bookId: 'abc', type: 'string' });
    expect((await get('/alias-test/raw/0')).json()).toEqual({ bookId: '0', type: 'string' });
    expect((await get('/alias-test/raw/-5')).json()).toEqual({ bookId: '-5', type: 'string' });
    expect((await post('/alias-test/untyped', { bookId: 5.5, bookIds: ['x', null, -6] })).json()).toEqual({
      body: { bookId: 5.5, bookIds: ['x', null, -6] },
      bookIdType: 'number',
    });
    expect(bookAlias.resolve).not.toHaveBeenCalled();
  });

  it('does nothing on a route without the decorator', async () => {
    expect((await get('/alias-test/undecorated/5')).json()).toEqual({ bookId: 5 });
    expect(bookAlias.resolve).not.toHaveBeenCalled();
  });

  it('rewrites a scalar body id before the DTO is validated', async () => {
    const response = await post('/alias-test/dto', { bookId: 7 });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ bookId: 12 });
  });

  it('keeps a numeric-string body id a string', async () => {
    expect((await post('/alias-test/untyped', { bookId: '5' })).json()).toEqual({ body: { bookId: '9' }, bookIdType: 'string' });
  });

  it('resolves an array element-wise and removes the duplicates the merge created', async () => {
    const response = await post('/alias-test/dto', { bookIds: [5, 9, 6, 3, 7] });

    expect(response.json()).toEqual({ bookIds: [9, 3, 12] });
    expect(bookAlias.resolve).toHaveBeenCalledTimes(1);
    expect(bookAlias.resolve).toHaveBeenCalledWith([5, 9, 6, 3, 7]);
  });

  it('looks up each distinct id once across every named field', async () => {
    const response = await post('/alias-test/dto', { bookId: 5, bookIds: [5, 6, 5] });

    expect(response.json()).toEqual({ bookId: 9, bookIds: [9] });
    expect(bookAlias.resolve).toHaveBeenCalledTimes(1);
    expect(bookAlias.resolve).toHaveBeenCalledWith([5, 6]);
  });

  it('leaves an array with nothing merged exactly as sent, duplicates included', async () => {
    const response = await post('/alias-test/untyped', { bookIds: [3, 3] });

    expect(response.json()).toEqual({ body: { bookIds: [3, 3] }, bookIdType: 'undefined' });
  });

  it('passes a non-HTTP context through without reading the request', async () => {
    const reflector = { get: vi.fn().mockReturnValue({ params: ['bookId'] }) };
    const interceptor = new MergedBookAliasInterceptor(
      reflector as unknown as Reflector,
      bookAlias as unknown as BookAliasService,
      bookService as unknown as BookService,
    );
    const context = { getHandler: vi.fn(), getType: () => 'ws', switchToHttp: vi.fn() } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('handled') };

    await expect(firstValueFrom(interceptor.intercept(context, next))).resolves.toBe('handled');
    expect(context.switchToHttp).not.toHaveBeenCalled();
    expect(bookAlias.resolve).not.toHaveBeenCalled();
  });
});
