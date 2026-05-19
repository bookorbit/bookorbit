type LoggerConfigModule = typeof import('./logger.config');

async function loadLoggerConfig(nodeEnv: 'development' | 'production', logLevel?: string): Promise<LoggerConfigModule['loggerConfig']> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (logLevel === undefined) {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', nodeEnv);
  } else {
    vi.stubEnv('LOG_LEVEL', logLevel);
  }

  const mod = await import('./logger.config');
  return mod.loggerConfig;
}

describe('loggerConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses info level and pretty transport by default in development', async () => {
    const config = await loadLoggerConfig('development');

    expect(config.pinoHttp?.level).toBe('info');
    expect(config.pinoHttp).toEqual(
      expect.objectContaining({
        transport: expect.objectContaining({
          target: 'pino-pretty',
        }),
      }),
    );
  });

  it('honors LOG_LEVEL override and omits pretty transport in production', async () => {
    const config = await loadLoggerConfig('production', 'warn');

    expect(config.pinoHttp?.level).toBe('warn');
    expect(config.pinoHttp).not.toHaveProperty('transport');
  });

  it('formats HTTP success/error messages and chooses log levels by status/error', async () => {
    const config = await loadLoggerConfig('development');
    const pinoHttp = config.pinoHttp!;

    expect(pinoHttp.customSuccessMessage?.({ method: 'GET', url: '/api/books' } as never, { statusCode: 201 } as never, 7.2)).toBe(
      '[HTTP] GET /api/books 201 +7ms',
    );

    expect(pinoHttp.customErrorMessage?.({ method: 'POST', url: '/api/books' } as never, { statusCode: 500 } as never, new Error('boom'))).toBe(
      '[HTTP] POST /api/books 500 - boom',
    );

    expect(pinoHttp.customLogLevel?.({} as never, { statusCode: 200 } as never)).toBe('debug');
    expect(pinoHttp.customLogLevel?.({} as never, { statusCode: 404 } as never)).toBe('warn');
    expect(pinoHttp.customLogLevel?.({} as never, { statusCode: 503 } as never)).toBe('error');
    expect(pinoHttp.customLogLevel?.({} as never, { statusCode: 200 } as never, new Error('fail'))).toBe('error');
    expect(pinoHttp.customProps).toBeUndefined();
  });

  it('filters framework context logs while keeping regular logs', async () => {
    const config = await loadLoggerConfig('development');
    const logMethod = config.pinoHttp?.hooks?.logMethod;
    const sink = vi.fn();
    expect(logMethod).toBeDefined();

    logMethod?.call({}, [{ context: 'InstanceLoader', msg: 'skip me' }], sink);
    expect(sink).not.toHaveBeenCalled();

    logMethod?.call({}, [{ context: 'AppBootstrap', msg: 'keep me' }], sink);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('serializes request and response objects with minimal fields', async () => {
    const config = await loadLoggerConfig('development');
    const serializers = config.pinoHttp?.serializers;
    expect(serializers?.req?.({ id: 'req-1', method: 'GET', url: '/api/x' } as never)).toEqual({
      id: 'req-1',
      method: 'GET',
      url: '/api/x',
    });
    expect(serializers?.res?.({ statusCode: 204 } as never)).toEqual({ statusCode: 204 });
  });

  it('SEC-031: redact config is present and covers sensitive fields', async () => {
    const config = await loadLoggerConfig('production');
    const redact = config.pinoHttp?.redact as { paths: string[]; censor: string } | undefined;

    expect(redact).toBeDefined();
    expect(redact?.paths).toContain('req.headers.authorization');
    expect(redact?.paths).toContain('req.headers.cookie');
    expect(redact?.paths).toContain('req.body.password');
    expect(redact?.paths).toContain('req.body.currentPassword');
    expect(redact?.paths).toContain('req.body.newPassword');
    expect(redact?.paths).toContain('req.body.token');
    expect(redact?.paths).toContain('req.body.clientSecret');
    expect(redact?.paths).toContain('req.body.codeVerifier');
    expect(redact?.censor).toBe('[REDACTED]');
  });
});
