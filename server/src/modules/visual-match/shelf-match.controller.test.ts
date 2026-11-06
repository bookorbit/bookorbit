import { CanActivate, ExecutionContext, Injectable, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import type { RequestUser } from '../../common/types/request-user';
import { AppAttestGuard } from '../app-attest/app-attest.guard';
import { ShelfMatchController } from './shelf-match.controller';
import { VisualMatchService } from './visual-match.service';

const reader = { id: 7, username: 'reader', isSuperuser: false, permissions: [] } as unknown as RequestUser;

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: RequestUser }>().user = reader;
    return true;
  }
}

describe('ShelfMatchController', () => {
  let app: NestFastifyApplication;
  const visualMatch = { matchShelf: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ShelfMatchController],
      providers: [
        { provide: VisualMatchService, useValue: visualMatch },
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
    visualMatch.matchShelf.mockReset();
  });

  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/mobile/shelf-match', payload: payload as object });

  it('answers 200 with the service’s results for the signed-in reader', async () => {
    const results = [{ id: 's1', matches: [], author: null }];
    visualMatch.matchShelf.mockResolvedValue({ results });

    const response = await post({ spines: [{ id: 's1', lines: ['DUNE', 'HERBERT'] }] });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results });
    expect(visualMatch.matchShelf).toHaveBeenCalledWith(reader, { spines: [{ id: 's1', lines: ['DUNE', 'HERBERT'] }] });
  });

  it('refuses a field a spine does not declare with a 400, before matching', async () => {
    const response = await post({ spines: [{ id: 's1', lines: ['DUNE'], isbn: '9780441013593' }] });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('isbn');
    expect(visualMatch.matchShelf).not.toHaveBeenCalled();
  });

  it('refuses a spine without an id and a shelf over the limit', async () => {
    expect((await post({ spines: [{ lines: ['DUNE'] }] })).statusCode).toBe(400);
    expect((await post({ spines: Array.from({ length: 41 }, (_, index) => ({ id: `s${index}`, lines: [] })) })).statusCode).toBe(400);
    expect(visualMatch.matchShelf).not.toHaveBeenCalled();
  });
});
