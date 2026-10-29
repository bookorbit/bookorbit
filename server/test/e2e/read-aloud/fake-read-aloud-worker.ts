import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ReadAloudWorkerEvent, ReadAloudWorkerJob, ReadAloudWorkerRequest } from '@bookorbit/types';
import { READ_ALOUD_WORKER_PROTOCOL } from '@bookorbit/types';

import { createZipArchiveFixture } from '../metadata-write/metadata-write-fixture-builder';

/** What the next run of a job produces. */
export type FakeOutcome = 'aligned' | 'weak' | 'fail' | 'hang';

type FakeJob = ReadAloudWorkerJob & { request: ReadAloudWorkerRequest; allEvents: ReadAloudWorkerEvent[] };

const TOTALS = {
  sentences: 3,
  matchedSentences: 3,
  interpolatedSentences: 0,
  unmatchedSentences: 0,
  droppedSentences: 0,
  seconds: 30,
  matchedSeconds: 30,
  interpolatedSeconds: 0,
  looseSeconds: 0,
  tracks: 1,
  unalignedTracks: 0,
  spine: { aligned: 3 },
};

/**
 * Speaks the worker protocol over real HTTP and writes a genuine media-overlay EPUB and report into
 * the job folder, so the server's validation and publishing run against real files.
 */
export class FakeReadAloudWorker {
  readonly requests: Array<{ method: string; path: string; body: ReadAloudWorkerRequest | null }> = [];
  outcome: FakeOutcome = 'aligned';
  libraryRoots: string[];
  private readonly jobs = new Map<string, FakeJob>();
  private server: Server | null = null;

  constructor(
    private readonly token: string,
    libraryRoots: string[],
  ) {
    this.libraryRoots = libraryRoots;
  }

  get url(): string {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) throw new Error('Fake worker is not listening');
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** Simulates a worker restart: every job it knew about is forgotten. */
  forgetJobs(): void {
    this.jobs.clear();
  }

  /** Reported in health like the real worker, which runs one job at a time. */
  private activeJobId(): string | null {
    for (const job of this.jobs.values()) if (job.status === 'queued' || job.status === 'running') return job.jobId;
    return null;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) return send(response, 401, { error: 'Unauthorized' });
    const url = new URL(request.url ?? '/', 'http://worker.local');
    const body = request.method === 'POST' ? ((await readJson(request)) as ReadAloudWorkerRequest) : null;
    this.requests.push({ method: request.method ?? 'GET', path: url.pathname, body });

    if (request.method === 'GET' && url.pathname === '/health') {
      return send(response, 200, {
        status: 'ok',
        version: 'fake',
        protocol: READ_ALOUD_WORKER_PROTOCOL,
        activeJobId: this.activeJobId(),
        activeJobs: this.activeJobId() ? 1 : 0,
        capacity: 1,
        device: 'cpu',
        configuredDevice: 'auto',
        deviceCheck: 'not_checked',
        libraryRoots: this.libraryRoots,
        workRoot: '/work',
        freeBytes: 1e12,
        platform: 'linux',
        architecture: 'x64',
      });
    }
    if (request.method === 'POST' && url.pathname === '/v1/jobs' && body) {
      const existing = this.jobs.get(body.jobId);
      if (existing && (existing.status === 'queued' || existing.status === 'running')) return send(response, 200, this.publicJob(existing, 0));
      const job: FakeJob = {
        jobId: body.jobId,
        status: 'running',
        stage: body.resumeFrom ?? 'preparing_audio',
        progress: 5,
        stageDetail: null,
        errorCode: null,
        error: null,
        outputBytes: null,
        events: [],
        request: body,
        allEvents: [],
      };
      this.jobs.set(job.jobId, job);
      this.event(job, 'job_started', job.stage);
      void this.run(job, this.outcome);
      return send(response, 202, this.publicJob(job, 0));
    }
    const match = /^\/v1\/jobs\/([0-9a-f-]{36})$/.exec(url.pathname);
    const job = match ? this.jobs.get(match[1]!) : undefined;
    if (match && !job) return send(response, 404, { error: 'Job not found', errorCode: 'unknown' });
    if (job && request.method === 'GET') return send(response, 200, this.publicJob(job, Number(url.searchParams.get('afterSeq') ?? 0)));
    if (job && request.method === 'DELETE') {
      if (job.status === 'running' || job.status === 'queued') job.status = 'cancelled';
      return send(response, 200, this.publicJob(job, Number.MAX_SAFE_INTEGER));
    }
    return send(response, 404, { error: 'Not found', errorCode: 'unknown' });
  }

  private async run(job: FakeJob, outcome: FakeOutcome): Promise<void> {
    await sleep(150);
    if (job.status !== 'running') return;
    if (outcome === 'hang') return;
    if (outcome === 'fail') {
      job.status = 'failed';
      job.errorCode = 'inference_failed';
      job.error = 'The speech model could not run';
      this.event(job, 'inference_failed', 'generating_emissions', 'error');
      return;
    }
    job.stage = 'aligning';
    job.progress = 80;
    job.stageDetail = { current: 2, total: 3, unit: 'chapter' };
    this.event(job, 'stage_started', 'aligning');
    await writeOutput(job.request.workDir, outcome === 'weak');
    job.stage = 'validating';
    job.progress = 100;
    job.status = 'completed';
    this.event(job, 'job_completed', 'validating');
  }

  private event(job: FakeJob, code: string, stage: FakeJob['stage'], level: ReadAloudWorkerEvent['level'] = 'info'): void {
    job.allEvents.push({ seq: job.allEvents.length + 1, at: new Date().toISOString(), level, stage, code, message: null, data: null });
  }

  private publicJob(job: FakeJob, afterSeq: number): ReadAloudWorkerJob {
    return {
      jobId: job.jobId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      stageDetail: job.stageDetail,
      errorCode: job.errorCode,
      error: job.error,
      outputBytes: job.outputBytes,
      events: job.allEvents.filter((event) => event.seq > afterSeq),
    };
  }
}

async function writeOutput(workDir: string, weak: boolean): Promise<void> {
  const chapters = [1, 2, 3];
  const entries = [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    {
      path: 'META-INF/container.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`,
    },
    {
      path: 'OPS/content.opf',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${randomUUID()}</dc:identifier>
    <dc:title>Generated</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta property="media:duration">0:00:30</meta>
  </metadata>
  <manifest>
${chapters
  .map(
    (n) => `    <item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml" media-overlay="s${n}" />
    <item id="s${n}" href="c${n}.smil" media-type="application/smil+xml" />`,
  )
  .join('\n')}
    <item id="audio" href="audio/0001.mp3" media-type="audio/mpeg" />
  </manifest>
  <spine>${chapters.map((n) => `<itemref idref="c${n}" />`).join('')}</spine>
</package>`,
    },
    ...chapters.flatMap((n) => [
      {
        path: `OPS/c${n}.xhtml`,
        content: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head><body><p><span id="c${n}-s1">Sentence ${n}.</span></p></body></html>`,
      },
      {
        path: `OPS/c${n}.smil`,
        content: `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body><seq epub:textref="c${n}.xhtml"><par><text src="c${n}.xhtml#c${n}-s1" /><audio src="audio/0001.mp3" clipBegin="${(n - 1) * 10}s" clipEnd="${n * 10}s" /></par></seq></body>
</smil>`,
      },
    ]),
    { path: 'OPS/audio/0001.mp3', content: Buffer.alloc(4096, 7) },
  ];
  await createZipArchiveFixture(workDir, 'output.epub', entries);
  const totals = weak ? { ...TOTALS, matchedSentences: 1, unmatchedSentences: 2 } : TOTALS;
  const spine = chapters.map((n) => ({
    index: n - 1,
    href: `OPS/c${n}.xhtml`,
    title: `Chapter ${n}`,
    status: weak && n > 1 ? 'not-found' : 'aligned',
    classification: { zone: 'body', verdict: 'include', decidedBy: null, signals: [] },
    decision: null,
    sentenceCount: 1,
    matchedSentenceCount: weak && n > 1 ? 0 : 1,
    interpolatedSentenceCount: 0,
    droppedSentenceCount: 0,
    matchedSeconds: 10,
    score: 0.9,
    preview: `Sentence ${n}.`,
    firstMatch: null,
    lastMatch: null,
  }));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${workDir}/report.json`, JSON.stringify({ version: 4, aligner: 'ctc', autoExclude: true, spine, totals }));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
