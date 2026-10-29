import {
  ReadAloudWorkerClientService,
  WorkerJobNotFoundError,
  WorkerRejectedError,
  WorkerUnreachableError,
} from './read-aloud-worker-client.service';
import { JOB_ID, okHealth } from './test-helpers';

const CONFIG = {
  workerUrl: 'http://worker:8787',
  workerToken: 'x'.repeat(32),
  workRoot: '/data/read-aloud/jobs',
  maxOutputBytes: 1e9,
  requestTimeoutMs: 1_000,
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('ReadAloudWorkerClientService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports not_configured without a URL and token', async () => {
    const client = new ReadAloudWorkerClientService({ ...CONFIG, workerUrl: undefined, workerToken: undefined } as never);
    expect(client.configured).toBe(false);
    await expect(client.healthState()).resolves.toEqual({ state: 'not_configured' });
  });

  it('separates a compatible worker from one speaking another protocol', async () => {
    vi.stubGlobal('fetch', respond(200, okHealth().health));
    await expect(new ReadAloudWorkerClientService(CONFIG as never).healthState()).resolves.toMatchObject({ state: 'ok' });

    vi.stubGlobal('fetch', respond(200, { ...okHealth().health, protocol: 99 }));
    await expect(new ReadAloudWorkerClientService(CONFIG as never).healthState()).resolves.toMatchObject({ state: 'incompatible' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(new ReadAloudWorkerClientService(CONFIG as never).healthState()).resolves.toEqual({ state: 'unreachable' });
  });

  it('sends the bearer token and asks only for new events', async () => {
    const fetchMock = respond(200, { jobId: JOB_ID, status: 'running', events: [] });
    vi.stubGlobal('fetch', fetchMock);
    await new ReadAloudWorkerClientService(CONFIG as never).status(JOB_ID, 41);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://worker:8787/v1/jobs/${JOB_ID}?afterSeq=41`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'x'.repeat(32)}`);
    expect(init.redirect).toBe('error');
  });

  it('refuses an answer larger than any job state, whether or not it declares its length', async () => {
    const client = new ReadAloudWorkerClientService(CONFIG as never);
    const huge = new Uint8Array(9 * 1024 * 1024).fill(32);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(huge, { status: 200, headers: { 'Content-Length': String(huge.byteLength) } })));
    await expect(client.status(JOB_ID, 0)).rejects.toMatchObject({ code: 'worker_incompatible' });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 9; index++) controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    await expect(client.status(JOB_ID, 0)).rejects.toMatchObject({ code: 'worker_incompatible' });
  });

  it('maps worker answers to transient, lost, and rejected failures', async () => {
    const client = new ReadAloudWorkerClientService(CONFIG as never);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(client.status(JOB_ID, 0)).rejects.toBeInstanceOf(WorkerUnreachableError);

    vi.stubGlobal('fetch', respond(503, { error: 'busy', errorCode: 'worker_unavailable' }));
    await expect(client.start({ jobId: JOB_ID } as never)).rejects.toBeInstanceOf(WorkerUnreachableError);

    vi.stubGlobal('fetch', respond(404, { error: 'Job not found' }));
    await expect(client.status(JOB_ID, 0)).rejects.toBeInstanceOf(WorkerJobNotFoundError);

    vi.stubGlobal('fetch', respond(400, { error: 'outside roots', errorCode: 'library_not_mounted' }));
    await expect(client.start({ jobId: JOB_ID } as never)).rejects.toMatchObject({ code: 'library_not_mounted' });

    vi.stubGlobal('fetch', respond(400, { error: 'weird', errorCode: 'EACCES' }));
    await expect(client.start({ jobId: JOB_ID } as never)).rejects.toMatchObject({ code: 'unknown' });

    vi.stubGlobal('fetch', respond(401, { error: 'Unauthorized' }));
    const rejected = await client.status(JOB_ID, 0).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(WorkerRejectedError);
    expect(rejected).toMatchObject({ code: 'worker_unavailable' });
  });
});
