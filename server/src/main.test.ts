import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AddressInfo } from 'node:net';

vi.mock('./app.module', () => ({ AppModule: class {} }));

describe('server bind address', () => {
  let app: NestFastifyApplication | undefined;
  let moduleFixture: TestingModule;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('JWT_SECRET', 'bind-address-test-secret');
    vi.stubEnv('SWAGGER_ENABLED', 'false');
  });

  afterEach(async () => {
    await app?.close();
    if (!app) await moduleFixture?.close();
    app = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    { host: undefined, expected: '0.0.0.0' },
    { host: '', expected: '0.0.0.0' },
    { host: '127.0.0.1', expected: '127.0.0.1' },
    { host: ' 127.0.0.1 ', expected: '127.0.0.1' },
    { host: '::1', expected: '::1' },
  ])('starts the real bootstrap with HOST=$host on $expected', async ({ host, expected }) => {
    vi.stubEnv('HOST', host);
    const { NestFactory } = await import('@nestjs/core');
    const { ConfigModule } = await import('@nestjs/config');
    const { Logger } = await import('nestjs-pino');
    const { appConfig } = await import('./config/config');
    const { validateEnv } = await import('./config/env.validation');

    moduleFixture = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, validate: validateEnv, load: [appConfig] })],
      providers: [{ provide: Logger, useValue: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), verbose: vi.fn() } }],
    }).compile();
    const create = vi.spyOn(NestFactory, 'create').mockImplementation((_module, adapter) => {
      const fastifyAdapter = adapter as FastifyAdapter;
      fastifyAdapter.getInstance().get('/bind-probe', () => ({ ok: true }));
      app = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter, { logger: false });
      vi.spyOn(app, 'listen');
      return Promise.resolve(app);
    });

    await import('./main');
    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledOnce();
      expect(app?.getHttpServer().listening).toBe(true);
    });

    const address = app!.getHttpServer().address() as AddressInfo;
    expect(address.address).toBe(expected);
    expect(app!.listen).toHaveBeenCalledWith('0', expected);
    const requestHost = expected === '::1' ? '[::1]' : '127.0.0.1';
    const response = await fetch(`http://${requestHost}:${address.port}/bind-probe`, { signal: AbortSignal.timeout(3000) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
