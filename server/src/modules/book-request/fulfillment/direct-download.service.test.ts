import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The fetcher pins the connection to the address that passed policy, and that path goes through
 * undici's fetch rather than the global one. What is under test here is the service, not the
 * dispatcher, so undici is pointed back at whatever stub each test installed.
 */
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

import { Agent } from 'undici';

import { DirectDownloadService, stagedDirectFileName } from './direct-download.service';

const HASH = 'a'.repeat(40);
/** Real time a case may spend waiting on event-loop turns, and a test budget that outlasts it. */
const SETTLE_MS = 5_000;
const FAKE_CLOCK = { timeout: 30_000 };

describe('DirectDownloadService', () => {
  let appDataPath: string;
  let service: DirectDownloadService;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-http-'));
    service = new DirectDownloadService({ appDataPath } as never);
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(appDataPath, { recursive: true, force: true });
  });

  function fileResponse(body: string, headers: Record<string, string> = {}): Response {
    return new Response(body, { headers: { 'content-type': 'application/epub+zip', ...headers } });
  }

  /** Waits for the fire-and-forget download, which `add` deliberately does not await. */
  async function settle() {
    return vi.waitFor(async () => {
      const [status] = await service.status([HASH]);
      expect(status.state === 'completed' || status.state === 'failed').toBe(true);
      return status;
    });
  }

  it('writes the file into its staging directory and reports where it landed', async () => {
    fetchMock.mockResolvedValue(fileResponse('a real epub would go here'));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
    const status = await settle();

    expect(status.state).toBe('completed');
    expect(status.progressPercent).toBe(100);
    expect(status.contentPath).toBe(join(appDataPath, 'request-downloads', HASH, 'book.epub'));
    await expect(readFile(status.contentPath!, 'utf8')).resolves.toBe('a real epub would go here');
  });

  /**
   * The importer classifies by extension alone, so a name the source did not put one on is a file
   * it finds no book in. Inspection reported this release ready, which is a promise the staged
   * name has to keep rather than one the download breaks.
   */
  it('stages a nameless file under the format the source declared', async () => {
    fetchMock.mockResolvedValue(fileResponse('a real epub would go here'));

    await service.add({ fileUrl: 'https://archive.org/download/x/get', fileName: 'download', format: 'epub', infoHash: HASH });

    expect((await settle()).contentPath).toBe(join(appDataPath, 'request-downloads', HASH, 'download.epub'));
  });

  /**
   * A content-length that is not a whole number of kilobytes used to be fatal: the transfer budget
   * was derived from it, and `AbortSignal.timeout` rejects a fractional delay outright. This
   * failed against the live archive on a 187712 byte EPUB while every mocked test passed.
   */
  it('accepts a content-length that does not divide evenly', async () => {
    fetchMock.mockResolvedValue(fileResponse('payload', { 'content-length': '187712' }));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });

    expect((await settle()).state).toBe('completed');
  });

  /**
   * Timers and the clock are faked; `setImmediate` is not. Staging the file and resolving the host
   * are real I/O that only completes on real event-loop turns, so faking everything would stop the
   * download before it started.
   */
  function withFakeClock<T>(body: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    return body().finally(() => vi.useRealTimers());
  }

  /** Bounded on the real clock, which `Date` being faked is exactly why this cannot use `Date`. */
  function realElapsedMs(from: bigint): number {
    return Number(process.hrtime.bigint() - from) / 1e6;
  }

  /** Real event-loop turns, so the fs and DNS work `add` kicks off can actually finish. */
  async function until(predicate: () => boolean, ms = SETTLE_MS): Promise<void> {
    const started = process.hrtime.bigint();
    while (!predicate() && realElapsedMs(started) < ms) await new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Moves `Date` on without faking the timers the transfer itself needed to be real, and puts it
   * back afterwards so the offset cannot leak into the next case.
   */
  async function atLaterTime<T>(offsetMs: number, body: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + offsetMs });
    try {
      return await body();
    } finally {
      vi.useRealTimers();
    }
  }

  /**
   * Real turns until the transfer has taken the bytes just pushed. A fixed pause was enough here
   * and timed out on a loaded runner, where the clock could pass the idle timeout before the
   * watchdog these cases advance had been armed at all, leaving a transfer nothing would end.
   */
  async function untilDownloaded(bytes: number, ms = SETTLE_MS): Promise<void> {
    const started = process.hrtime.bigint();
    while (realElapsedMs(started) < ms) {
      const [status] = await service.status([HASH]);
      if (status.downloadedBytes >= bytes) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /** What `settle` does, without the faked `setTimeout` that `vi.waitFor` would need. */
  async function settleOnRealTurns() {
    const started = process.hrtime.bigint();
    while (realElapsedMs(started) < SETTLE_MS) {
      const [status] = await service.status([HASH]);
      if (status.state === 'completed' || status.state === 'failed') return status;
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { state: 'never settled', errorMessage: null } as never;
  }

  /** A body the test feeds by hand, so a transfer can be spread across as much clock as it likes. */
  function trickleResponse() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(source) {
        controller = source;
      },
    });
    return {
      response: new Response(body, { headers: { 'content-type': 'application/epub+zip' } }),
      push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
      close: () => controller.close(),
    };
  }

  /**
   * The regression that made every LibriVox grab fail. The connect deadline was set with
   * `AbortSignal.timeout`, whose signal stays attached to the response body, so a 239 MB zip
   * streaming at 6 MB/s was aborted at exactly 30 seconds with three quarters of it written.
   * Gutenberg's one-megabyte EPUBs land long before that, which is why nothing caught it.
   */
  it('lets a download outlive the deadline for reaching the server', FAKE_CLOCK, async () => {
    await withFakeClock(async () => {
      let handed: AbortSignal | undefined;
      fetchMock.mockImplementation((_url, init) => {
        handed = init?.signal ?? undefined;
        return Promise.resolve(fileResponse('a real epub would go here'));
      });

      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      await until(() => handed !== undefined);
      // Well past the connect deadline, which by then has nothing left to say about the transfer.
      vi.advanceTimersByTime(90_000);

      await expect(settleOnRealTurns()).resolves.toMatchObject({ state: 'completed' });
      expect(handed!.aborted).toBe(false);
    });
  });

  /** The other half: dropping the deadline once headers arrive must not drop it before they do. */
  it('still gives up on a server that never sends its headers', FAKE_CLOCK, async () => {
    await withFakeClock(async () => {
      let asked = false;
      fetchMock.mockImplementation((_url, init) => {
        asked = true;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        });
      });

      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      await until(() => asked);
      vi.advanceTimersByTime(31_000);

      await expect(settleOnRealTurns()).resolves.toMatchObject({ state: 'failed' });
    });
  });

  /**
   * The second half of the same defect. The body had a budget that scaled with the file size but
   * still assumed a floor on throughput: about 1 MB/s, so a 239 MB audiobook needed 5.4 Mbit/s and
   * anything slower spent six minutes downloading before being told the line was too slow. A slow
   * transfer is not a failed one, and nothing here bounds how long an honest one may take.
   */
  it('finishes a slow transfer that keeps sending, however long it takes', FAKE_CLOCK, async () => {
    await withFakeClock(async () => {
      const trickle = trickleResponse();
      fetchMock.mockResolvedValue(trickle.response);

      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      // Ten minutes of transfer, for a file the old size-scaled budget allowed two.
      const chunk = 'another chunk of the audiobook';
      for (let minute = 0; minute < 10; minute++) {
        trickle.push(chunk);
        await untilDownloaded(chunk.length * (minute + 1));
        vi.advanceTimersByTime(60_000);
      }
      trickle.close();

      await expect(settleOnRealTurns()).resolves.toMatchObject({ state: 'completed' });
    });
  });

  /** Slow is not stalled, and the difference is whether anything is still arriving. */
  it('gives up on a transfer that stops sending altogether', FAKE_CLOCK, async () => {
    await withFakeClock(async () => {
      const trickle = trickleResponse();
      fetchMock.mockResolvedValue(trickle.response);

      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      const chunk = 'the only chunk that ever arrives';
      trickle.push(chunk);
      await untilDownloaded(chunk.length);
      vi.advanceTimersByTime(130_000);

      await expect(settleOnRealTurns()).resolves.toMatchObject({ state: 'failed', errorMessage: expect.stringMatching(/sent nothing/) });
    });
  });

  /** An open library answers a wrong path with a courtesy page and a 200, not a 404. */
  it('fails a response that is a web page rather than a file', async () => {
    fetchMock.mockResolvedValue(new Response('<html>not found</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
    const status = await settle();

    expect(status.state).toBe('failed');
    expect(status.errorMessage).toMatch(/web page/);
  });

  /**
   * Which is exactly what a file host does when it reads `node` in the agent header, so the cause
   * arrives as the failure above and names nothing. Saying who we are is what gets us served.
   */
  it('names itself rather than letting Node announce the request as node', async () => {
    fetchMock.mockResolvedValue(fileResponse('a real epub would go here'));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
    await settle();

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('BookOrbit');
  });

  it('fails a file that declares itself past the size cap', async () => {
    fetchMock.mockResolvedValue(fileResponse('x', { 'content-length': String(64 * 1024 * 1024 * 1024) }));

    await service.add({ fileUrl: 'https://archive.org/download/x/huge.m4b', fileName: 'huge.m4b', infoHash: HASH });

    expect((await settle()).state).toBe('failed');
  });

  it('fails an empty file rather than importing nothing', async () => {
    fetchMock.mockResolvedValue(fileResponse(''));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });

    expect((await settle()).state).toBe('failed');
  });

  /**
   * `redirect: 'follow'` would let a redirect to a private address through, which is exactly what
   * the containment check exists to stop, so each hop is checked in turn.
   */
  it('refuses a redirect to a private address', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } }));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });

    expect((await settle()).state).toBe('failed');
  });

  it('gives up rather than following redirects forever', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 302, headers: { location: 'https://archive.org/again' } }));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
    const status = await settle();

    expect(status.state).toBe('failed');
    expect(status.errorMessage).toMatch(/redirected more than/);
  });

  /** The filename comes from an external source, so it must not be able to choose a path. */
  it('keeps a traversing filename inside the download directory', async () => {
    fetchMock.mockResolvedValue(fileResponse('payload'));

    await service.add({ fileUrl: 'https://archive.org/download/x/b', fileName: '../../escaped.epub', infoHash: HASH });
    const status = await settle();

    expect(status.state).toBe('completed');
    expect(status.contentPath!.startsWith(join(appDataPath, 'request-downloads', HASH))).toBe(true);
  });

  /**
   * A release URL comes from an indexer, so this is the caller that cannot live with a name that
   * resolves publicly to be approved and privately to be connected to. The refusal itself is
   * proven in `safe-fetch.test.ts`; what matters here is that this path asks for it.
   */
  it('connects only to the address that passed policy', async () => {
    fetchMock.mockResolvedValue(fileResponse('a real epub would go here'));

    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
    await settle();

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ dispatcher: expect.any(Agent) });
  });

  /**
   * Reported the way a download client reports a torrent it does not hold: by leaving it out. The
   * poll loop reads an unmapped `unknown` as `downloading`, so answering with one left a transfer a
   * restart interrupted sitting at "downloading 0%" until the twelve-hour stall timeout.
   */
  it('leaves a hash it has never seen out of the answer rather than reporting a state for it', async () => {
    await expect(service.status(['b'.repeat(40)])).resolves.toEqual([]);
  });

  it('deletes only the staged copy, the library hardlink being a separate one', async () => {
    fetchMock.mockResolvedValue(fileResponse('payload'));
    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
    await settle();

    await service.remove(HASH, { deleteFiles: true });

    await expect(stat(join(appDataPath, 'request-downloads', HASH))).rejects.toThrow();
    await expect(service.status([HASH])).resolves.toEqual([]);
  });

  /**
   * Nothing collects a failed attempt. It is no longer polled, `cleanupStagedDirectDownload` runs
   * only after a successful import, and `removeLatestForRequest` only on cancel or delete - so
   * whatever the failure wrote sits under its own hash directory until the disk fills. The size
   * ceiling is the worst of them: it is checked after the chunk is appended, so tripping it means
   * roughly eight gigabytes are already written.
   */
  describe('staging after a failure', () => {
    async function stagingExists(): Promise<boolean> {
      return stat(join(appDataPath, 'request-downloads', HASH)).then(
        () => true,
        () => false,
      );
    }

    it('leaves nothing behind when the server answers with a page rather than a file', async () => {
      fetchMock.mockResolvedValue(new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } }));

      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      await settle();

      expect(await stagingExists()).toBe(false);
    });

    it('leaves nothing behind when the file declares itself past the size cap', async () => {
      fetchMock.mockResolvedValue(fileResponse('x', { 'content-length': String(64 * 1024 * 1024 * 1024) }));

      await service.add({ fileUrl: 'https://archive.org/download/x/huge.m4b', fileName: 'huge.m4b', infoHash: HASH });
      await settle();

      expect(await stagingExists()).toBe(false);
    });

    it('leaves nothing behind when the connection fails outright', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      await settle();

      expect(await stagingExists()).toBe(false);
    });

    it('leaves nothing behind when the stream breaks partway through', async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('the first half'));
          controller.error(new Error('the connection dropped'));
        },
      });
      fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/epub+zip' } }));

      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      await settle();

      expect(await stagingExists()).toBe(false);
    });

    /** Read once by the poll loop and then never again, so the entry must not outlive the process. */
    it('drops a terminal entry once nothing could still be reading it', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      expect((await settle()).state).toBe('failed');

      const reported = await atLaterTime(11 * 60 * 1000, () => service.status([HASH]));

      expect(reported).toEqual([]);
    });

    /** Dropping it too early would replace the reason it failed with "the client has never heard of it". */
    it('keeps a terminal entry readable while the poll loop could still want it', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      await settle();

      const state = await atLaterTime(60 * 1000, async () => (await service.status([HASH]))[0].state);

      expect(state).toBe('failed');
    });
  });

  /**
   * Progress lives in memory, so a transfer a restart interrupted leaves bytes nothing will ever
   * poll, import or remove - and each failed URL stages under its own hash rather than reusing one.
   */
  describe('reapStaging', () => {
    const OTHER = 'c'.repeat(40);

    async function stage(hash: string): Promise<void> {
      await mkdir(join(appDataPath, 'request-downloads', hash), { recursive: true });
    }

    it('removes a directory no live attempt is behind and keeps the ones that are', async () => {
      await stage(HASH);
      await stage(OTHER);

      const reaped = await service.reapStaging(new Set([OTHER]));

      expect(reaped).toBe(1);
      await expect(stat(join(appDataPath, 'request-downloads', HASH))).rejects.toThrow();
      await expect(stat(join(appDataPath, 'request-downloads', OTHER))).resolves.toBeDefined();
    });

    /** A transfer this process is running has no row saying so until the grab commits. */
    it('never reaps a directory this process is downloading into', async () => {
      const trickle = trickleResponse();
      fetchMock.mockResolvedValue(trickle.response);
      await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

      expect(await service.reapStaging(new Set())).toBe(0);
      await expect(stat(join(appDataPath, 'request-downloads', HASH))).resolves.toBeDefined();

      trickle.push('payload');
      trickle.close();
      await settle();
    });

    it('says nothing was reaped when the root does not exist yet', async () => {
      await expect(service.reapStaging(new Set())).resolves.toBe(0);
    });
  });

  it('aborts an active transfer before deleting its partial staging file', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/epub+zip', 'content-length': '1000' } }));
    await service.add({ fileUrl: 'https://archive.org/download/x/book.epub', fileName: 'book.epub', infoHash: HASH });
    await vi.waitFor(async () => {
      expect((await service.status([HASH]))[0].downloadedBytes).toBeGreaterThan(0);
    });

    await service.remove(HASH, { deleteFiles: true });

    await expect(service.status([HASH])).resolves.toEqual([]);
    await expect(stat(join(appDataPath, 'request-downloads', HASH))).rejects.toThrow();
  });
});

/**
 * The rule the staged name follows, which inspection reads too: the two have to agree or a release
 * is accepted, downloaded in full, and then refused for a condition inspection called safe.
 */
describe('stagedDirectFileName', () => {
  it('gives a nameless file the declared extension', () => {
    expect(stagedDirectFileName('download', 'epub')).toBe('download.epub');
    expect(stagedDirectFileName('', 'epub')).toBe('download.epub');
    expect(stagedDirectFileName(null, 'M4B')).toBe('download.m4b');
    expect(stagedDirectFileName('download', '.epub')).toBe('download.epub');
  });

  /** A `.zip` holding an epub is an archive the importer extracts; `book.zip.epub` is not. */
  it('leaves a name that already carries an extension alone', () => {
    expect(stagedDirectFileName('book.zip', 'epub')).toBe('book.zip');
    expect(stagedDirectFileName('book.epub', 'epub')).toBe('book.epub');
  });

  /** Nothing to promise: an unsupported format is refused at inspection rather than dressed up. */
  it('adds nothing for a format the importer does not support', () => {
    expect(stagedDirectFileName('download', 'html')).toBe('download');
    expect(stagedDirectFileName(null, 'html')).toBe('download.bin');
    expect(stagedDirectFileName(undefined, undefined)).toBe('download.bin');
  });
});
