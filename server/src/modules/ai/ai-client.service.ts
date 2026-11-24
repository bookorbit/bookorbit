import { Injectable, Logger } from '@nestjs/common';
import type { AiFailureCode, AiJsonSupport, AiModelPrices, AiSlot, AiUsageOutcome } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiAdapter, AiAdapterResult, AiAdapterUsage, AiMessage, AiProviderError } from './adapters/ai-adapter.interface';
import { EFFORT_PARAMETERS, isWebPage } from './adapters/ai-adapter-common';
import { AI_ADAPTERS } from './adapters';
import { AiBudgetService, toMicros } from './ai-budget.service';
import { AiError, type AiErrorDetails, type AiRequest, type AiResult, type AiSlotChoice, type AiUsage } from './ai-client.types';
import { AiConnectionService, type ResolvedAiConnection } from './ai-connection.service';
import { AI_EVENTS, AiEventsService, type AiSlotFailingEvent, type AiSlotHealthyEvent } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import { extractJson, repairMessage, validateJson } from './ai-json';
import { AiLedgerRepository } from './ai-ledger.repository';
import { AiLimiterAbortedError, AiLimiterService } from './ai-limiter';
import { aiMonthKey } from './ai-month';
import { AI_MAX_RESPONSE_BYTES, AiHttpService, AiNetworkError, classifyAiNetworkError, type AiHttpResponse } from './ai-network';
import { scrubSecrets } from './ai-scrub';
import { AiSettingsService, type AiSettingsSnapshot } from './ai-settings.service';
import { readSseEvents } from './ai-sse';

/** Waits before the second to fifth try after a network error, a timeout, a 5xx or a 429 without `retry-after`. */
export const AI_RETRY_DELAYS_MS = [5_000, 20_000, 60_000, 120_000];
/** Tries per request for errors that may pass by themselves. */
export const AI_MAX_TRIES = AI_RETRY_DELAYS_MS.length + 1;
/** A `retry-after` longer than this gives up instead of waiting. */
const MAX_RETRY_AFTER_SECONDS = 600;
/** Every attempt of one request, retries of all kinds together; a backstop against loops. */
const MAX_ATTEMPTS = 12;
/** A conservative token count for text: three bytes of UTF-8 per token. */
const BYTES_PER_TOKEN = 3;
/** A picture's tokens by its pixels, the most any supported API type charges for one. */
const PIXELS_PER_IMAGE_TOKEN = 750;
/** A streamed answer has someone waiting: one quick retry, and only before the first token. */
export const AI_STREAM_RETRY_DELAYS_MS = [1_000];
const AI_STREAM_TRIES = AI_STREAM_RETRY_DELAYS_MS.length + 1;
/** The most one streamed event or the provider's silence between chunks may be. */
const STREAM_MAX_EVENT_BYTES = 256 * 1024;
const STREAM_IDLE_MS = 30_000;

export interface AiCompleteOptions {
  /** For the admin's Try it, which runs before a feature is on. */
  ignoreFeatureSwitch?: boolean;
}

/** What `AiClient.stream` yields: pieces of the answer as they arrive, then the whole result once. */
export type AiStreamEvent = { delta: string } | { done: AiResult };

export interface AiStreamOptions {
  /**
   * Called with the text so far after each piece; true ends the answer there as finished, and the
   * provider stops being read. Usage is then estimated, since providers count it at the end.
   */
  stopWhen?: (text: string) => boolean;
}

type Step = { done: AiResult } | { retry: true; delayMs?: number; transient?: AiFailureCode };

interface Attempt {
  number: number;
  startedAt: Date;
}

/** Everything one `complete` call carries between attempts. */
interface Run {
  request: AiRequest;
  choice: AiSlotChoice;
  connection: ResolvedAiConnection & { id: number };
  adapter: AiAdapter;
  settings: AiSettingsSnapshot;
  json: AiJsonSupport | 'none';
  messages: AiMessage[];
  maxOutputTokens: number;
  /** Every attempt the provider billed for, so retries count toward the job as well as the ledger. */
  spent: { usage: AiAdapterUsage; cost: number | null };
  lengthRetried: boolean;
  repaired: boolean;
  transientFailures: number;
  lastTransient: { failure: AiFailureCode; message: string } | null;
  secrets: string[];
  host: string;
  /** Tries for errors that may pass, and the waits between them. */
  transientLimit: number;
  delays: readonly number[];
  /** Someone is waiting on screen: ahead of builds in the queue, and a connection is not marked failing over it. */
  interactive: boolean;
}

/**
 * What features call. A request names a feature and a slot; the client resolves the slot to a
 * connection and model, checks the feature switch and the budget, waits for the connection's
 * limiter, and turns the reply into text and validated JSON. Every attempt is one ledger row.
 *
 * Errors that need the admin (a rejected key, no credit, a wrong URL) are not retried: the
 * connection is marked failing and the caller gets a typed error to pause on. Errors that may pass
 * (5xx, timeouts, 429) are retried with backoff, then reported as `provider-down`.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  /** Optional parameters a connection and model rejected, left out until the server restarts. */
  private readonly rejectedParameters = new Map<string, Set<string>>();
  /** Overridden in tests. */
  retryDelaysMs: readonly number[] = AI_RETRY_DELAYS_MS;
  streamRetryDelaysMs: readonly number[] = AI_STREAM_RETRY_DELAYS_MS;

  constructor(
    private readonly connections: AiConnectionService,
    private readonly settings: AiSettingsService,
    private readonly budget: AiBudgetService,
    private readonly ledger: AiLedgerRepository,
    private readonly limiters: AiLimiterService,
    private readonly http: AiHttpService,
    private readonly bridge: AiJobsBridge,
    private readonly events: AiEventsService,
  ) {}

  /** The connection, model and terms a slot uses now; a job records this at start. */
  async resolveSlot(slot: AiSlot, settings?: AiSettingsSnapshot): Promise<AiSlotChoice> {
    const chosen = (settings ?? (await this.settings.snapshot())).slots[slot];
    if (chosen.connectionId === null || chosen.model === null) {
      throw new AiError('slot-empty', `No connection and model are chosen for the ${slot} slot`);
    }
    return {
      slot,
      connectionId: chosen.connectionId,
      model: chosen.model,
      prices: chosen.prices,
      jsonMode: chosen.jsonMode,
      maxOutputTokens: chosen.maxOutputTokens,
      ...(chosen.effort !== 'auto' ? { effort: chosen.effort } : {}),
    };
  }

  async complete(request: AiRequest, options: AiCompleteOptions = {}): Promise<AiResult> {
    const run = await this.prepare(request, options, false);
    try {
      for (let number = 1; number <= MAX_ATTEMPTS; number++) {
        const step = await this.attempt(run, number);
        if ('done' in step) return step.done;
        if (!(await this.beforeRetry(run, step))) break;
      }
      return await this.giveUp(run);
    } catch (err) {
      if (err instanceof AiError && hasSpent(run)) err.spent = spentUsage(run);
      throw err;
    }
  }

  /**
   * A plain-text answer as it is written, for someone waiting on screen. The same checks and ledger
   * as `complete`, but it queues ahead of builds, retries once and only before the first piece, and
   * never retries a reply cut short. A stream the caller abandons, or that the signal aborts, is
   * still recorded, with the usage estimated from what was sent and received.
   */
  async *stream(request: AiRequest, options: AiStreamOptions = {}): AsyncGenerator<AiStreamEvent, void, undefined> {
    if (request.schema || request.images?.length) throw new Error('A streamed answer is plain text');
    const run = await this.prepare(request, {}, true);
    for (let number = 1; number <= MAX_ATTEMPTS; number++) {
      const step = yield* this.streamAttempt(run, number, options);
      if ('done' in step) return;
      if (!(await this.beforeRetry(run, step))) break;
    }
    await this.giveUp(run);
  }

  private async prepare(request: AiRequest, options: AiCompleteOptions, interactive: boolean): Promise<Run> {
    throwIfCancelled(request.signal);
    const settings = await this.settings.snapshot();
    if (!options.ignoreFeatureSwitch && !isEnabled(settings, request.feature)) {
      throw new AiError('off', 'This AI feature is turned off');
    }

    const choice =
      request.use ??
      (request.jobId ? await this.bridge.jobSlotChoice(request.jobId, request.slot) : null) ??
      (await this.resolveSlot(request.slot, settings));
    const connection = (await this.connections.resolve(choice.connectionId)) as ResolvedAiConnection & { id: number };
    return {
      request,
      choice,
      connection,
      adapter: AI_ADAPTERS[connection.apiType],
      settings,
      json: !request.schema ? 'none' : choice.jsonMode === 'auto' ? (connection.jsonSupport ?? 'schema') : choice.jsonMode,
      messages: [{ role: 'user', content: userContent(request) }],
      maxOutputTokens: request.maxOutputTokens,
      spent: { usage: { input: 0, output: 0, reasoning: 0, cached: 0 }, cost: null },
      lengthRetried: false,
      repaired: false,
      transientFailures: 0,
      lastTransient: null,
      secrets: AiConnectionService.secretsOf(connection),
      host: hostOf(connection.baseUrl),
      transientLimit: interactive ? AI_STREAM_TRIES : AI_MAX_TRIES,
      delays: interactive ? this.streamRetryDelaysMs : this.retryDelaysMs,
      interactive,
    };
  }

  /** Counts a failed attempt and waits before the next one; false once the request should give up. */
  private async beforeRetry(run: Run, step: Exclude<Step, { done: AiResult }>): Promise<boolean> {
    if (step.transient) {
      run.transientFailures++;
      if (run.transientFailures >= run.transientLimit) return false;
    }
    const delay = step.delayMs ?? 0;
    if (delay > 0) await sleep(delay, run.request.signal);
    return true;
  }

  private async *streamAttempt(run: Run, number: number, options: AiStreamOptions): AsyncGenerator<AiStreamEvent, Step, undefined> {
    const { request, choice, connection, adapter } = run;
    await this.budget.checkRequest({ feature: request.feature, jobId: request.jobId, worstCaseMicros: this.worstCase(run) });

    const httpRequest = adapter.buildRequest(
      { baseUrl: connection.baseUrl, key: connection.key, headers: connection.headers },
      {
        model: choice.model,
        system: request.system,
        messages: run.messages,
        json: 'none',
        maxOutputTokens: run.maxOutputTokens,
        effort: choice.effort ?? request.effort,
        effortChosen: choice.effort !== undefined,
        omit: this.omitFor(run),
        stream: true,
      },
    );

    const release = await this.acquire(run);
    const attempt: Attempt = { number, startedAt: new Date() };
    const received = { text: '', recorded: false };
    try {
      let opened: Awaited<ReturnType<AiHttpService['open']>>;
      try {
        opened = await this.http.open(httpRequest, {
          networkProfile: connection.networkProfile,
          timeoutMs: connection.timeoutMs,
          signal: request.signal,
        });
      } catch (err) {
        if (!(err instanceof AiNetworkError)) throw err;
        received.recorded = true;
        return await this.onNetworkError(run, attempt, err);
      }

      if (opened.kind === 'whole') {
        received.recorded = true;
        if (opened.status < 200 || opened.status >= 300) return await this.onProviderError(run, attempt, adapter.parseError(opened), opened);
        const parsed = adapter.parseResponse(opened);
        if (!parsed) {
          const error: AiProviderError = isWebPage(opened)
            ? { kind: 'not-api', status: opened.status, message: 'This URL answered with a web page, not an API' }
            : { kind: 'server', status: opened.status, message: 'The provider sent a reply that could not be read' };
          return await this.onProviderError(run, attempt, error, opened);
        }
        if (parsed.finish !== 'refused' && parsed.finish !== 'filtered' && parsed.text) yield { delta: parsed.text };
        const done = await this.streamed(run, attempt, parsed, opened.durationMs);
        yield { done };
        return { done };
      }

      const reply: AiAdapterResult = {
        text: '',
        finish: 'stop',
        usage: { input: 0, output: 0, reasoning: 0, cached: 0 },
        usageReported: false,
        model: '',
      };
      try {
        for await (const event of readSseEvents(opened.body, {
          maxEventBytes: STREAM_MAX_EVENT_BYTES,
          maxTotalBytes: AI_MAX_RESPONSE_BYTES,
          idleMs: STREAM_IDLE_MS,
        })) {
          const piece = adapter.parseStreamEvent(event);
          if (!piece) continue;
          if (piece.error) {
            if (received.text === '') {
              received.recorded = true;
              return await this.onProviderError(run, attempt, piece.error, {
                status: piece.error.status,
                headers: new Headers(),
                text: '',
                durationMs: elapsed(attempt),
              });
            }
            throw new AiNetworkError('provider-error', scrubSecrets(piece.error.message, run.secrets));
          }
          if (piece.model) reply.model = piece.model;
          if (piece.usage) {
            reply.usageReported = true;
            reply.usage = largest(reply.usage, piece.usage);
          }
          if (piece.finish && reply.finish !== 'refused') reply.finish = piece.finish;
          if (piece.delta) {
            received.text += piece.delta;
            yield { delta: piece.delta };
            if (options.stopWhen?.(received.text)) {
              reply.finish = 'stop';
              reply.usageReported = false;
              break;
            }
          }
          if (piece.end) break;
        }
      } catch (err) {
        const failure = err instanceof AiNetworkError ? err : classifyAiNetworkError(err, request.signal);
        if (received.text === '' && !failure.extra.aborted && !request.signal?.aborted) {
          received.recorded = true;
          return await this.onNetworkError(run, attempt, failure);
        }
        received.recorded = true;
        const cancelledNow = failure.extra.aborted || request.signal?.aborted === true;
        await this.recordEstimate(
          run,
          attempt,
          cancelledNow ? 'error:cancelled' : failure.failure === 'timeout' ? 'timeout' : 'error:provider-down',
          received.text,
        );
        if (cancelledNow) throw cancelled();
        throw new AiError('provider-down', scrubSecrets(failure.message, run.secrets), { connectionId: connection.id, failure: failure.failure });
      }

      reply.text = received.text;
      received.recorded = true;
      const done = await this.streamed(run, attempt, reply, elapsed(attempt));
      yield { done };
      return { done };
    } finally {
      release();
      // The caller stopped reading mid-answer: what was sent and received still cost something.
      if (!received.recorded) await this.recordEstimate(run, attempt, 'error:cancelled', received.text);
    }
  }

  /** Records a streamed reply and turns it into a result. A reply cut short is kept as it is. */
  private async streamed(run: Run, attempt: Attempt, reply: AiAdapterResult, durationMs: number): Promise<AiResult> {
    const usage = reply.usageReported ? reply.usage : this.estimatedUsage(run, reply.text);
    const cost = costOf(usage, run.choice.prices);
    const outcome: AiUsageOutcome = reply.finish === 'stop' ? 'ok' : reply.finish;
    await this.record(run, attempt, outcome, usage, cost, durationMs);
    if (reply.finish === 'stop' || reply.finish === 'length') await this.clearSlotHealth(run);
    const refused = reply.finish === 'refused' || reply.finish === 'filtered';
    return { text: refused ? '' : reply.text, usage: spentUsage(run), finish: reply.finish, model: reply.model || run.choice.model };
  }

  private async recordEstimate(run: Run, attempt: Attempt, outcome: AiUsageOutcome, received: string): Promise<void> {
    const usage = this.estimatedUsage(run, received);
    await this.record(run, attempt, outcome, usage, costOf(usage, run.choice.prices), elapsed(attempt));
  }

  /** Tokens for a request the provider did not count: what was sent, and what came back, at three bytes a token. */
  private estimatedUsage(run: Run, received: string): AiAdapterUsage {
    const sent = Buffer.byteLength(run.request.system ?? '', 'utf8') + run.messages.reduce((total, message) => total + textBytes(message.content), 0);
    return {
      input: Math.ceil(sent / BYTES_PER_TOKEN),
      output: Math.ceil(Buffer.byteLength(received, 'utf8') / BYTES_PER_TOKEN),
      reasoning: 0,
      cached: 0,
    };
  }

  private async acquire(run: Run): Promise<() => void> {
    const { connection, request } = run;
    try {
      return await this.limiters
        .for(connection.id)
        .acquire(
          { maxParallel: connection.maxParallel, requestsPerMinute: connection.requestsPerMinute },
          request.signal,
          run.interactive ? 'interactive' : 'background',
        );
    } catch (err) {
      if (err instanceof AiLimiterAbortedError) throw cancelled();
      throw err;
    }
  }

  private async attempt(run: Run, number: number): Promise<Step> {
    const { request, choice, connection, adapter } = run;
    await this.budget.checkRequest({ feature: request.feature, jobId: request.jobId, worstCaseMicros: this.worstCase(run) });

    const httpRequest = adapter.buildRequest(
      { baseUrl: connection.baseUrl, key: connection.key, headers: connection.headers },
      {
        model: choice.model,
        system: request.system,
        messages: run.messages,
        json: run.json,
        schema: request.schema,
        maxOutputTokens: run.maxOutputTokens,
        effort: choice.effort ?? request.effort,
        effortChosen: choice.effort !== undefined,
        omit: this.omitFor(run),
      },
    );

    const release = await this.acquire(run);
    const attempt: Attempt = { number, startedAt: new Date() };
    let response: AiHttpResponse;
    try {
      response = await this.http.send(httpRequest, {
        networkProfile: connection.networkProfile,
        timeoutMs: connection.timeoutMs,
        signal: request.signal,
      });
    } catch (err) {
      release();
      if (!(err instanceof AiNetworkError)) throw err;
      return this.onNetworkError(run, attempt, err);
    }
    release();

    if (response.status >= 200 && response.status < 300) {
      const parsed = adapter.parseResponse(response);
      if (parsed) return this.onReply(run, attempt, parsed, response);
      const error: AiProviderError = isWebPage(response)
        ? { kind: 'not-api', status: response.status, message: 'This URL answered with a web page, not an API' }
        : { kind: 'server', status: response.status, message: 'The provider sent a reply that could not be read' };
      return this.onProviderError(run, attempt, error, response);
    }
    return this.onProviderError(run, attempt, adapter.parseError(response), response);
  }

  private async onReply(run: Run, attempt: Attempt, reply: AiAdapterResult, response: AiHttpResponse): Promise<Step> {
    const { request, choice } = run;
    const cost = costOf(reply.usage, choice.prices);
    const result = (text: string, json?: unknown): AiResult => ({
      text,
      ...(json !== undefined ? { json } : {}),
      usage: spentUsage(run),
      finish: reply.finish,
      model: reply.model || choice.model,
    });

    if (reply.finish === 'refused' || reply.finish === 'filtered') {
      await this.record(run, attempt, reply.finish, reply.usage, cost, response.durationMs);
      return { done: result('') };
    }

    if (reply.finish === 'length') {
      await this.record(run, attempt, 'length', reply.usage, cost, response.durationMs);
      const next = Math.min(run.maxOutputTokens * 2, choice.maxOutputTokens ?? Number.POSITIVE_INFINITY);
      if (run.lengthRetried || next <= run.maxOutputTokens) {
        throw new AiError('too-long', 'The reply was cut short even with twice the output allowance', { connectionId: run.connection.id });
      }
      run.lengthRetried = true;
      run.maxOutputTokens = next;
      return { retry: true };
    }

    let json: unknown;
    if (request.schema) {
      const extracted = extractJson(reply.text);
      const problem = extracted.ok ? validateJson(extracted.value, request.schema) : extracted.error;
      if (problem !== null) {
        await this.record(run, attempt, 'invalid-json', reply.usage, cost, response.durationMs);
        if (run.repaired) {
          throw new AiError('invalid-json', 'The reply did not match the expected JSON after one repair', {
            connectionId: run.connection.id,
            validation: problem,
          });
        }
        run.repaired = true;
        run.messages = [...run.messages, { role: 'assistant', content: reply.text }, { role: 'user', content: repairMessage(problem) }];
        return { retry: true };
      }
      json = extracted.ok ? extracted.value : undefined;
    }

    await this.record(run, attempt, 'ok', reply.usage, cost, response.durationMs);
    await this.clearSlotHealth(run);
    return { done: result(reply.text, json) };
  }

  private async onProviderError(run: Run, attempt: Attempt, error: AiProviderError, response: AiHttpResponse): Promise<Step> {
    const message = scrubSecrets(error.message, run.secrets);
    const details: AiErrorDetails = { connectionId: run.connection.id, providerMessage: message };
    const usage = { input: 0, output: 0, reasoning: 0, cached: 0 };
    const record = (outcome: AiUsageOutcome) => this.record(run, attempt, outcome, usage, null, response.durationMs, error.status);

    switch (error.kind) {
      case 'bad-parameter': {
        const omitted = this.omitted(run.connection.id, run.choice.model);
        await record('error:bad-request');
        if (run.choice.effort && error.parameter && EFFORT_PARAMETERS.has(error.parameter)) {
          // Left out, the model would run at its own default, which some providers set to their highest level.
          const reason = `The model refused the effort level ${run.choice.effort}`;
          await this.markSlotFailing(run, 'effort-rejected', reason);
          throw new AiError('bad-request', `${reason}: ${message}`, { ...details, failure: 'effort-rejected' });
        }
        if (error.parameter && !omitted.has(error.parameter)) {
          omitted.add(error.parameter);
          this.logger.log(
            `[ai-client] [parameter] host=${sanitizeLogValue(run.host)} model=${sanitizeLogValue(run.choice.model)} parameter=${sanitizeLogValue(error.parameter)} - Retrying without a rejected parameter`,
          );
          return { retry: true };
        }
        throw new AiError('bad-request', `The provider refused the request: ${message}`, details);
      }
      case 'rate-limited': {
        await record('rate-limited');
        run.lastTransient = { failure: 'rate-limited', message: 'The provider kept answering 429 Too Many Requests' };
        if (error.retryAfterSeconds === undefined) return { retry: true, transient: 'rate-limited', delayMs: this.backoff(run) };
        if (error.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) {
          await this.markFailing(run, 'rate-limited', `The provider asked to wait ${error.retryAfterSeconds} seconds`);
          throw new AiError('provider-down', 'The provider asked to wait longer than BookOrbit waits', {
            ...details,
            failure: 'rate-limited',
            retryAfterSeconds: error.retryAfterSeconds,
          });
        }
        // The whole connection waits, not only this request; the next acquire waits with it.
        this.limiters.for(run.connection.id).hold(error.retryAfterSeconds * 1000);
        return { retry: true, transient: 'rate-limited' };
      }
      case 'server':
        await record('error:provider-down');
        run.lastTransient = { failure: 'provider-error', message: `The provider answered ${error.status}: ${message}` };
        return { retry: true, transient: 'provider-error', delayMs: this.backoff(run) };
      case 'auth':
      case 'credit':
      case 'spend-limit': {
        await record('error:provider-auth');
        const failure: AiFailureCode = error.kind === 'auth' ? 'key-rejected' : error.kind === 'credit' ? 'out-of-credit' : 'spend-limit';
        const reason =
          error.kind === 'auth'
            ? 'The provider rejected the key'
            : error.kind === 'credit'
              ? 'The provider account is out of credit'
              : 'The provider account reached its spend limit';
        await this.markFailing(run, failure, reason);
        throw new AiError('provider-auth', reason, { ...details, failure });
      }
      case 'model-missing': {
        await record('error:model-missing');
        await this.markSlotFailing(run, 'model-missing', 'Model no longer available');
        throw new AiError('model-missing', `The model ${run.choice.model} is no longer available`, { ...details, failure: 'model-missing' });
      }
      case 'context-length':
        await record('error:too-long');
        throw new AiError('too-long', 'The input is longer than the model accepts', details);
      case 'not-api':
      case 'endpoint-missing': {
        await record('error:provider-down');
        const failure: AiFailureCode = error.kind === 'not-api' ? 'web-page' : 'provider-error';
        const reason = error.kind === 'not-api' ? 'This URL answered with a web page, not an API' : 'The provider has no such API at this URL';
        await this.markFailing(run, failure, reason);
        throw new AiError('provider-down', reason, { ...details, failure });
      }
      default:
        await record('error:bad-request');
        throw new AiError('bad-request', `The provider refused the request: ${message}`, details);
    }
  }

  private async onNetworkError(run: Run, attempt: Attempt, error: AiNetworkError): Promise<Step> {
    const durationMs = Date.now() - attempt.startedAt.getTime();
    const usage = { input: 0, output: 0, reasoning: 0, cached: 0 };
    if (error.extra.aborted || run.request.signal?.aborted) {
      await this.record(run, attempt, 'error:cancelled', usage, null, durationMs);
      throw cancelled();
    }
    const message = scrubSecrets(error.message, run.secrets);
    if (error.failure === 'timeout' || error.failure === 'unreachable' || error.failure === 'provider-error') {
      await this.record(run, attempt, error.failure === 'timeout' ? 'timeout' : 'error:provider-down', usage, null, durationMs);
      run.lastTransient = { failure: error.failure, message };
      return { retry: true, transient: error.failure, delayMs: this.backoff(run) };
    }
    // A redirect, a certificate, a blocked address or a bad URL: none passes by itself.
    await this.record(run, attempt, 'error:provider-down', usage, null, durationMs);
    await this.markFailing(run, error.failure, message);
    throw new AiError('provider-down', message, { connectionId: run.connection.id, failure: error.failure });
  }

  private async giveUp(run: Run): Promise<never> {
    const last = run.lastTransient ?? { failure: 'unreachable' as const, message: 'The provider could not be reached' };
    // Two quick tries for one reader say little about the connection; builds keep that judgement.
    if (!run.interactive) await this.markFailing(run, last.failure, last.message);
    throw new AiError('provider-down', last.message, { connectionId: run.connection.id, failure: last.failure });
  }

  /** The delay before the next try after this many transient failures (counting the one just had). */
  private backoff(run: Run): number {
    const delays = run.delays;
    return delays[Math.min(run.transientFailures, delays.length - 1)] ?? 0;
  }

  /**
   * What the next attempt leaves out. A level the slot chose is always sent, even where a feature's
   * level was refused before, so a refusal reaches the admin instead of being skipped.
   */
  private omitFor(run: Run): ReadonlySet<string> {
    const omitted = this.omitted(run.connection.id, run.choice.model);
    if (!run.choice.effort) return omitted;
    return new Set([...omitted].filter((parameter) => !EFFORT_PARAMETERS.has(parameter)));
  }

  private omitted(connectionId: number, model: string): Set<string> {
    const key = `${connectionId}\u0000${model}`;
    let set = this.rejectedParameters.get(key);
    if (!set) {
      set = new Set();
      this.rejectedParameters.set(key, set);
    }
    return set;
  }

  /**
   * The most the next attempt can cost: every input byte of text as a third of a token, each
   * picture by its pixels, plus the full output allowance.
   */
  private worstCase(run: Run): number | null {
    const prices = run.choice.prices;
    if (!prices) return null;
    const inputBytes =
      Buffer.byteLength(run.request.system ?? '', 'utf8') +
      run.messages.reduce((total, message) => total + textBytes(message.content), 0) +
      (run.request.schema ? Buffer.byteLength(JSON.stringify(run.request.schema), 'utf8') : 0);
    const imageTokens = (run.request.images ?? []).reduce(
      (total, image) => total + Math.ceil((image.width * image.height) / PIXELS_PER_IMAGE_TOKEN),
      0,
    );
    const inputTokens = Math.ceil(inputBytes / BYTES_PER_TOKEN) + imageTokens;
    return toMicros((inputTokens * prices.input + run.maxOutputTokens * prices.output) / 1_000_000);
  }

  private async record(
    run: Run,
    attempt: Attempt,
    outcome: AiUsageOutcome,
    usage: AiAdapterUsage,
    cost: number | null,
    durationMs: number,
    status?: number,
  ): Promise<void> {
    const { request, choice, connection } = run;
    run.spent.usage = {
      input: run.spent.usage.input + usage.input,
      output: run.spent.usage.output + usage.output,
      reasoning: run.spent.usage.reasoning + usage.reasoning,
      cached: run.spent.usage.cached + usage.cached,
    };
    if (cost !== null) run.spent.cost = (run.spent.cost ?? 0) + cost;
    try {
      await this.ledger.insert({
        at: attempt.startedAt,
        month: aiMonthKey(attempt.startedAt),
        feature: request.feature,
        slot: choice.slot,
        connectionId: connection.id,
        model: choice.model,
        inputTokens: usage.input,
        outputTokens: usage.output,
        reasoningTokens: usage.reasoning,
        cachedTokens: usage.cached,
        costMicros: cost === null ? null : toMicros(cost),
        durationMs: Math.max(0, Math.round(durationMs)),
        outcome,
        jobId: request.jobId ?? null,
        attempt: attempt.number,
        userId: request.userId ?? null,
      });
    } catch (err) {
      this.logger.error(
        `[ai-client] [ledger] feature=${sanitizeLogValue(request.feature)} outcome=${outcome} - Could not record usage: ${sanitizeLogValue(err instanceof Error ? err.message : String(err))}`,
      );
    }
    const line = `[ai-client] [attempt] host=${sanitizeLogValue(run.host)} model=${sanitizeLogValue(choice.model)} attempt=${attempt.number} outcome=${outcome}${status ? ` status=${status}` : ''} input=${usage.input} output=${usage.output} durationMs=${Math.round(durationMs)} - Request finished`;
    if (outcome === 'ok') this.logger.debug(line);
    else this.logger.warn(line);
  }

  private async markFailing(run: Run, failure: AiFailureCode, reason: string): Promise<void> {
    this.logger.warn(
      `[ai-client] [connection] host=${sanitizeLogValue(run.host)} connection=${run.connection.id} code=${failure} - ${sanitizeLogValue(reason)}`,
    );
    await this.connections.markFailing(run.connection.id, failure, reason);
  }

  /** Marks the slot failing, unless the slot already moved to another model, connection or effort. */
  private async markSlotFailing(run: Run, code: AiFailureCode, reason: string): Promise<void> {
    const { choice } = run;
    const current = (await this.settings.slots())[choice.slot];
    const sameEffort = code !== 'effort-rejected' || current.effort === choice.effort;
    if (current.connectionId === choice.connectionId && current.model === choice.model && sameEffort) {
      await this.settings.setSlotHealth(choice.slot, { failingSince: new Date().toISOString(), code, reason, model: choice.model });
    }
    this.events.emit(AI_EVENTS.SLOT_FAILING, { slot: choice.slot, model: choice.model, code } satisfies AiSlotFailingEvent);
  }

  private async clearSlotHealth(run: Run): Promise<void> {
    const health = run.settings.slotHealth[run.choice.slot];
    if (!health || health.model !== run.choice.model) return;
    await this.settings.setSlotHealth(run.choice.slot, null);
    this.events.emit(AI_EVENTS.SLOT_HEALTHY, { slot: run.choice.slot } satisfies AiSlotHealthyEvent);
  }
}

/** The user message: its text alone, or its pictures first and then the text. */
function userContent(request: AiRequest): AiMessage['content'] {
  if (!request.images?.length) return request.user;
  return [
    ...request.images.map((image) => ({ type: 'image' as const, mediaType: image.mediaType, data: image.data })),
    { type: 'text' as const, text: request.user },
  ];
}

function textBytes(content: AiMessage['content']): number {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  return content.reduce((total, part) => total + (part.type === 'text' ? Buffer.byteLength(part.text, 'utf8') : 0), 0);
}

function isEnabled(settings: AiSettingsSnapshot, feature: string): boolean {
  return Object.prototype.hasOwnProperty.call(settings.features, feature) && settings.features[feature as keyof typeof settings.features].enabled;
}

/** Dollars: the provider's own figure when it sends one, else from the slot's prices. */
function costOf(usage: AiAdapterUsage, prices: AiModelPrices | null): number | null {
  if (usage.cost !== undefined) return usage.cost;
  if (!prices) return null;
  return (usage.input * prices.input + usage.output * prices.output) / 1_000_000;
}

function spentUsage(run: Run): AiUsage {
  return toUsage(run.spent.usage, run.spent.cost);
}

function hasSpent(run: Run): boolean {
  const { usage, cost } = run.spent;
  return cost !== null || usage.input + usage.output + usage.reasoning > 0;
}

function toUsage(usage: AiAdapterUsage, cost: number | null): AiUsage {
  return {
    input: usage.input,
    output: usage.output,
    ...(usage.reasoning ? { reasoning: usage.reasoning } : {}),
    ...(usage.cached ? { cached: usage.cached } : {}),
    ...(cost !== null ? { cost } : {}),
  };
}

/** The larger of each count, since a stream may send running totals or one figure at the end. */
function largest(current: AiAdapterUsage, next: AiAdapterUsage): AiAdapterUsage {
  const merged: AiAdapterUsage = {
    input: Math.max(current.input, next.input),
    output: Math.max(current.output, next.output),
    reasoning: Math.max(current.reasoning, next.reasoning),
    cached: Math.max(current.cached, next.cached),
  };
  const cost = next.cost ?? current.cost;
  if (cost !== undefined) merged.cost = cost;
  return merged;
}

function elapsed(attempt: Attempt): number {
  return Date.now() - attempt.startedAt.getTime();
}

function cancelled(): AiError {
  return new AiError('cancelled', 'The request was cancelled');
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'invalid-url';
  }
}
