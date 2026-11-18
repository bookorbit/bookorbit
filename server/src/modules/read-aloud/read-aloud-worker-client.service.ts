import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { ReadAloudErrorCode, ReadAloudWorkerHealth, ReadAloudWorkerJob, ReadAloudWorkerRequest } from '@bookorbit/types';
import { isReadAloudErrorCode, READ_ALOUD_WORKER_PROTOCOL } from '@bookorbit/types';

import { readAloudConfig } from '../../config/config';

const HEALTH_TTL_MS = 10_000;
const HEALTH_FAILURE_TTL_MS = 3_000;
/** `/health` is tiny; the job timeout would let a worker host that drops packets hold a caller for half a minute. */
const HEALTH_TIMEOUT_MS = 5_000;
/** Worker answers are small: a job's state carries at most the events this server has not stored yet. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** The worker could not be reached, timed out, or answered 5xx. Transient: try again later. */
export class WorkerUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkerUnreachableError';
  }
}

/** The worker has no record of the job, usually because it restarted. Re-submitting resumes it. */
export class WorkerJobNotFoundError extends Error {
  constructor(readonly jobId: string) {
    super('The worker has no record of this job');
    this.name = 'WorkerJobNotFoundError';
  }
}

/** The worker refused the request for a reason that retrying will not change. */
export class WorkerRejectedError extends Error {
  constructor(
    readonly code: ReadAloudErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerRejectedError';
  }
}

export type WorkerHealthState =
  | { state: 'not_configured' }
  | { state: 'unreachable' }
  | { state: 'incompatible'; health: ReadAloudWorkerHealth }
  | { state: 'ok'; health: ReadAloudWorkerHealth };

@Injectable()
export class ReadAloudWorkerClientService {
  private healthCache: { expiresAt: number; value: WorkerHealthState } | null = null;
  private healthProbe: Promise<WorkerHealthState> | null = null;

  constructor(@Inject(readAloudConfig.KEY) private readonly config: ConfigType<typeof readAloudConfig>) {}

  get configured(): boolean {
    return Boolean(this.config.workerUrl && this.config.workerToken);
  }

  /** A fresh state, or one cached for a few seconds. Callers asking at the same time share one probe; `force` always asks anew. */
  async healthState(force = false): Promise<WorkerHealthState> {
    if (!this.configured) return { state: 'not_configured' };
    if (force) return this.probeHealth();
    if (this.healthCache && this.healthCache.expiresAt > Date.now()) return this.healthCache.value;
    this.healthProbe ??= this.probeHealth().finally(() => {
      this.healthProbe = null;
    });
    return this.healthProbe;
  }

  /**
   * For display: the last state known, at once, refreshed behind the answer when it has gone stale.
   * Only a server that has never asked waits for the worker, so a worker host that is off cannot
   * hold up every book page while each probe times out.
   */
  async lastKnownHealthState(): Promise<WorkerHealthState> {
    if (!this.configured) return { state: 'not_configured' };
    const cached = this.healthCache;
    if (!cached) return this.healthState();
    if (cached.expiresAt <= Date.now()) void this.healthState();
    return cached.value;
  }

  private async probeHealth(): Promise<WorkerHealthState> {
    let value: WorkerHealthState;
    try {
      const health = await this.request<ReadAloudWorkerHealth>('/health', { method: 'GET', timeoutMs: HEALTH_TIMEOUT_MS });
      value = health.protocol === READ_ALOUD_WORKER_PROTOCOL ? { state: 'ok', health } : { state: 'incompatible', health };
    } catch {
      value = { state: 'unreachable' };
    }
    this.healthCache = { expiresAt: Date.now() + (value.state === 'unreachable' ? HEALTH_FAILURE_TTL_MS : HEALTH_TTL_MS), value };
    return value;
  }

  start(request: ReadAloudWorkerRequest): Promise<ReadAloudWorkerJob> {
    return this.request('/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      jobId: request.jobId,
    });
  }

  status(jobId: string, afterSeq: number): Promise<ReadAloudWorkerJob> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}?afterSeq=${afterSeq}`, { method: 'GET', jobId });
  }

  cancel(jobId: string): Promise<ReadAloudWorkerJob> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', jobId });
  }

  private async request<T>(path: string, init: RequestInit & { jobId?: string; timeoutMs?: number }): Promise<T> {
    if (!this.config.workerUrl || !this.config.workerToken) throw new WorkerUnreachableError('Read-aloud worker is not configured');
    const { jobId, timeoutMs, ...requestInit } = init;
    let response: Response;
    try {
      response = await fetch(`${this.config.workerUrl}${path}`, {
        ...requestInit,
        // The bearer token goes with every request, so it must never follow a redirect elsewhere.
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(timeoutMs ?? this.config.requestTimeoutMs, this.config.requestTimeoutMs)),
        headers: { ...requestInit.headers, Authorization: `Bearer ${this.config.workerToken}` },
      });
    } catch (error) {
      throw new WorkerUnreachableError('Read-aloud worker is unreachable', { cause: error });
    }
    if (response.ok) return (await readJson(response)) as T;
    const body = (await readJson(response).catch(() => null)) as { error?: unknown; errorCode?: unknown } | null;
    const message = typeof body?.error === 'string' ? body.error.slice(0, 300) : `Read-aloud worker returned ${response.status}`;
    if (response.status === 404 && jobId) throw new WorkerJobNotFoundError(jobId);
    if (response.status === 401) throw new WorkerRejectedError('worker_unavailable', 'The read-aloud worker rejected the shared token');
    if (response.status >= 500 || response.status === 429) throw new WorkerUnreachableError(message);
    throw new WorkerRejectedError(isReadAloudErrorCode(body?.errorCode) ? body.errorCode : 'unknown', message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const tooLarge = () => new WorkerRejectedError('worker_incompatible', 'The read-aloud worker sent a response larger than expected');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(chunk.value);
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
