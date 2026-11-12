import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AI_TEST_STEPS,
  AI_TEST_USAGE_FEATURE,
  type AiConnectionTest,
  type AiConnectionTestResult,
  type AiFailureCode,
  type AiJsonSupport,
  type AiModelList,
  type AiModelPrices,
  type AiTestStep,
  type AiTestStepId,
  type AiUsageOutcome,
} from '@bookorbit/types';

import { SystemCron } from '../../common/decorators/system-cron.decorator';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiAdapter, AiAdapterResult, AiAdapterTarget, AiProviderError, AiSend } from './adapters/ai-adapter.interface';
import { AiProviderFailure } from './adapters/ai-adapter.interface';
import { AI_ADAPTERS } from './adapters';
import { toMicros } from './ai-budget.service';
import { isAiError } from './ai-client.types';
import { AiConnectionRepository } from './ai-connection.repository';
import { AiConnectionService, type ResolvedAiConnection } from './ai-connection.service';
import { AI_EVENTS, AiEventsService, type AiSlotHealthyEvent } from './ai-events.service';
import { extractJson, validateJson } from './ai-json';
import { AiLedgerRepository } from './ai-ledger.repository';
import { aiMonthKey } from './ai-month';
import { AiHttpService, AiNetworkError, type AiHttpRequest, type AiHttpResponse } from './ai-network';
import { scrubSecrets } from './ai-scrub';
import { AiSettingsService } from './ai-settings.service';
import { AI_IMAGE_TEST_SCHEMA, AI_IMAGE_TEST_USER, AI_TEST_MAX_OUTPUT_TOKENS, AI_TEST_SCHEMA, AI_TEST_SYSTEM, AI_TEST_USER } from './ai-try-sample';
import { AI_VISION_SAMPLE, AI_VISION_SAMPLE_TITLES } from './ai-vision-sample';

/** Failures that may pass by themselves, so a failing connection is tested again automatically. */
const RETEST_CODES: ReadonlySet<AiFailureCode> = new Set(['unreachable', 'timeout', 'provider-error', 'rate-limited']);
/** How long automatic tests go on after a connection started failing. */
const RETEST_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The parameters each API type asks for JSON with; a 400 naming one means try the next way. */
const JSON_PARAMETERS = new Set(['response_format', 'text', 'output_config']);
/** The ways to ask for JSON, best first. Anthropic has no JSON mode of its own. */
const JSON_ORDER: Record<AiAdapter['apiType'], AiJsonSupport[]> = {
  'openai-chat': ['schema', 'json', 'instructions'],
  'openai-responses': ['schema', 'json', 'instructions'],
  'anthropic-messages': ['schema', 'instructions'],
};
/** Model ids that are not text models, skipped when picking a model to test with. */
const NOT_TEXT_MODEL = /embed|whisper|tts|dall-e|image|audio|moderation|rerank|transcribe|realtime|speech|vision-preview/i;

type Steps = Record<AiTestStepId, AiTestStep>;

interface TestContext {
  connection: ResolvedAiConnection;
  adapter: AiAdapter;
  target: AiAdapterTarget;
  steps: Steps;
  secrets: string[];
  send: AiSend;
  prices: AiModelPrices | null;
  attempt: number;
  /** Parameters the model refused during the JSON row, left out of the picture row too. */
  omit: ReadonlySet<string>;
}

/**
 * The connection test the dialog's last step runs: rows passing or failing in order, so the admin
 * learns which part is wrong. Also the model list and the automatic retest of
 * connections that failed with something that may pass by itself.
 */
@Injectable()
export class AiConnectionTestService {
  private readonly logger = new Logger(AiConnectionTestService.name);

  constructor(
    private readonly connections: AiConnectionService,
    private readonly repo: AiConnectionRepository,
    private readonly settings: AiSettingsService,
    private readonly ledger: AiLedgerRepository,
    private readonly http: AiHttpService,
    private readonly events: AiEventsService,
  ) {}

  /** Tests a saved connection, stores the result, and clears its failing state when it passes. */
  async testSaved(id: number, model?: string): Promise<AiConnectionTestResult> {
    const row = await this.connections.getRow(id);
    const slots = await this.settings.slots();
    const slotModel = Object.values(slots).find((slot) => slot.connectionId === id && slot.model)?.model ?? null;

    let result: AiConnectionTestResult;
    try {
      result = await this.test(await this.connections.resolveRow(row), { model, slotModel });
    } catch (err) {
      if (!isAiError(err) || !err.details.failure) throw err;
      result = this.blocked(row.baseUrl, model ?? slotModel, err.details.failure, err.message);
    }

    await this.repo.setLastTest(id, storedTest(result));
    if (result.ok) {
      if (row.failingSince) await this.connections.markHealthy(id);
      await this.clearSlotHealth(id, result.model);
    }
    this.logger.log(
      `[ai-test] [saved] connection=${id} host=${sanitizeLogValue(result.host)} model=${sanitizeLogValue(result.model ?? '')} ok=${result.ok} - Connection tested`,
    );
    return result;
  }

  /** Runs the test on a connection as it is, saved or not, without storing anything about it. */
  async test(connection: ResolvedAiConnection, options: { model?: string; slotModel?: string | null } = {}): Promise<AiConnectionTestResult> {
    const adapter = AI_ADAPTERS[connection.apiType];
    const steps = Object.fromEntries(AI_TEST_STEPS.map((id) => [id, { id, ok: null }])) as Steps;
    const ctx: TestContext = {
      connection,
      adapter,
      target: { baseUrl: connection.baseUrl, key: connection.key, headers: connection.headers },
      steps,
      secrets: AiConnectionService.secretsOf(connection),
      send: (request) => this.http.send(request, { networkProfile: connection.networkProfile, timeoutMs: connection.timeoutMs }),
      prices: null,
      attempt: 0,
      omit: new Set(),
    };

    const models = await this.checkModels(ctx);
    let model: string | null = null;
    let jsonSupport: AiJsonSupport | null = null;

    if (steps.reach.ok && steps.key.ok !== false) {
      model = options.model?.trim() || options.slotModel || firstTextModel(models);
      if (!model) {
        fail(steps.json, 'no-model', 'This provider has no model list; type the model name to test with');
      } else {
        ctx.prices = await this.pricesFor(connection.id, model, models);
        jsonSupport = await this.checkJson(ctx, model);
        if (jsonSupport) await this.checkImage(ctx, model, jsonSupport);
      }
    }

    const test: AiConnectionTest = {
      at: new Date().toISOString(),
      ok: steps.reach.ok === true && steps.key.ok === true && steps.json.ok === true,
      host: hostOf(connection.baseUrl),
      model,
      steps: AI_TEST_STEPS.map((id) => steps[id]),
      jsonSupport,
      modelCount: models?.listed ? models.models.length : null,
    };
    return { ...test, models };
  }

  /** The provider's model list for a saved connection, for the model select. */
  async listModels(id: number): Promise<AiModelList> {
    const row = await this.connections.getRow(id);
    let connection: ResolvedAiConnection;
    try {
      connection = await this.connections.resolveRow(row);
    } catch (err) {
      if (!isAiError(err)) throw err;
      throw new BadRequestException({
        message: err.message,
        errorCode: 'AI_PROVIDER_FAILED',
        ...(err.details.failure ? { errorMeta: { failure: err.details.failure } } : {}),
      });
    }
    const adapter = AI_ADAPTERS[connection.apiType];
    const secrets = AiConnectionService.secretsOf(connection);
    try {
      return await adapter.listModels({ baseUrl: connection.baseUrl, key: connection.key, headers: connection.headers }, (request) =>
        this.http.send(request, { networkProfile: connection.networkProfile, timeoutMs: connection.timeoutMs }),
      );
    } catch (err) {
      const message =
        err instanceof AiNetworkError
          ? err.message
          : err instanceof AiProviderFailure
            ? `The provider answered ${err.error.status}: ${err.error.message}`
            : 'The model list could not be read';
      throw new BadGatewayException({ message: scrubSecrets(message, secrets), errorCode: 'AI_PROVIDER_FAILED' });
    }
  }

  /**
   * Every 15 minutes, tests again each connection failing for less than a day with something that
   * may pass by itself (unreachable, timeouts, 5xx, rate limits). A pass resumes paused jobs.
   */
  @SystemCron('*/15 * * * *')
  async retestFailing(): Promise<void> {
    const now = Date.now();
    const due = (await this.repo.list()).filter(
      (row) => row.failingSince && row.failingCode && RETEST_CODES.has(row.failingCode) && now - row.failingSince.getTime() < RETEST_WINDOW_MS,
    );
    for (const row of due) {
      try {
        await this.testSaved(row.id);
      } catch (err) {
        this.logger.warn(
          `[ai-test] [retest] connection=${row.id} - Automatic test failed to run: ${sanitizeLogValue(err instanceof Error ? err.message : String(err))}`,
        );
      }
    }
  }

  /** Rows 1 to 3: reach the server, the key, the model list. */
  private async checkModels(ctx: TestContext): Promise<AiModelList | null> {
    const { steps } = ctx;
    let firstAnswerMs: number | null = null;
    const send: AiSend = async (request) => {
      const response = await ctx.send(request);
      firstAnswerMs ??= response.durationMs;
      return response;
    };

    let models: AiModelList | null = null;
    try {
      models = await ctx.adapter.listModels(ctx.target, send);
    } catch (err) {
      if (err instanceof AiNetworkError) {
        failNetwork(steps.reach, err, ctx.secrets);
        return null;
      }
      if (!(err instanceof AiProviderFailure)) throw err;
      if (err.error.kind === 'not-api') {
        fail(steps.reach, 'web-page', 'This URL answered with a web page, not an API');
        return null;
      }
      pass(steps.reach, { durationMs: firstAnswerMs ?? undefined });
      if (this.keyFailure(steps, err.error, ctx.secrets)) return null;
      failProvider(steps.models, err.error, ctx.secrets);
    }

    pass(steps.reach, { durationMs: firstAnswerMs ?? undefined });
    if (models) {
      if (models.listed) pass(steps.models, { modelCount: models.models.length });
      else pass(steps.models, { code: 'no-model-list', message: 'This provider has no model list; type the model name', modelCount: 0 });
    }

    const keyAccepted = await ctx.adapter.checkKey(ctx.target, ctx.send).catch(() => null);
    if (keyAccepted === false) fail(steps.key, 'key-rejected', 'The provider rejected the key');
    else if (keyAccepted === true || (models?.listed && ctx.connection.key)) pass(steps.key);
    return models;
  }

  /** Rows 4 and 5: the model answers in JSON, best way first, and reports its usage. */
  private async checkJson(ctx: TestContext, model: string): Promise<AiJsonSupport | null> {
    const { steps } = ctx;
    for (const mode of JSON_ORDER[ctx.adapter.apiType]) {
      const omit = new Set<string>();
      for (let tries = 0; tries < 4; tries++) {
        const request = ctx.adapter.buildRequest(ctx.target, {
          model,
          system: AI_TEST_SYSTEM,
          messages: [{ role: 'user', content: AI_TEST_USER }],
          json: mode,
          schema: AI_TEST_SCHEMA,
          maxOutputTokens: AI_TEST_MAX_OUTPUT_TOKENS,
          omit,
        });

        let response: AiHttpResponse;
        try {
          response = await this.sendRecorded(ctx, request, model);
        } catch (err) {
          if (!(err instanceof AiNetworkError)) throw err;
          failNetwork(steps.json, err, ctx.secrets);
          return null;
        }

        if (response.status >= 200 && response.status < 300) {
          const reply = ctx.adapter.parseResponse(response);
          if (!reply) {
            fail(steps.json, 'provider-error', 'The provider sent a reply that could not be read');
            return null;
          }
          if (steps.key.ok === null) pass(steps.key);
          this.checkUsage(steps, reply);
          if (reply.finish === 'refused' || reply.finish === 'filtered') {
            fail(steps.json, 'no-json', 'The model refused the test request');
            return null;
          }
          const extracted = extractJson(reply.text);
          if (extracted.ok && validateJson(extracted.value, AI_TEST_SCHEMA) === null) {
            pass(steps.json, { jsonSupport: mode });
            ctx.omit = omit;
            return mode;
          }
          break;
        }

        const error = ctx.adapter.parseError(response);
        if (error.kind === 'bad-parameter' && error.parameter) {
          if (JSON_PARAMETERS.has(error.parameter)) break;
          if (!omit.has(error.parameter)) {
            omit.add(error.parameter);
            continue;
          }
        }
        if (this.keyFailure(steps, error, ctx.secrets)) return null;
        failProvider(steps.json, error, ctx.secrets);
        return null;
      }
    }
    fail(steps.json, 'no-json', 'The model did not answer in JSON');
    return null;
  }

  /**
   * Row 6: the model reads the drawn covers. Only the Vision slot needs this, so a model that cannot
   * read pictures still passes the test.
   */
  private async checkImage(ctx: TestContext, model: string, mode: AiJsonSupport): Promise<void> {
    const { steps } = ctx;
    const request = ctx.adapter.buildRequest(ctx.target, {
      model,
      system: AI_TEST_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mediaType: AI_VISION_SAMPLE.mediaType, data: AI_VISION_SAMPLE.data },
            { type: 'text', text: AI_IMAGE_TEST_USER },
          ],
        },
      ],
      json: mode,
      schema: AI_IMAGE_TEST_SCHEMA,
      maxOutputTokens: AI_TEST_MAX_OUTPUT_TOKENS,
      omit: new Set(ctx.omit),
    });

    let response: AiHttpResponse;
    try {
      response = await this.sendRecorded(ctx, request, model);
    } catch (err) {
      if (!(err instanceof AiNetworkError)) throw err;
      failNetwork(steps.image, err, ctx.secrets);
      return;
    }

    if (response.status >= 200 && response.status < 300) {
      const reply = ctx.adapter.parseResponse(response);
      const extracted = reply && reply.finish !== 'refused' && reply.finish !== 'filtered' ? extractJson(reply.text) : null;
      if (extracted?.ok && readsSample(extracted.value)) pass(steps.image);
      else fail(steps.image, 'no-image-input', 'The model did not read the book titles in the test picture');
      return;
    }

    const error = ctx.adapter.parseError(response);
    if (error.kind === 'bad-request' || error.kind === 'bad-parameter') {
      fail(steps.image, 'no-image-input', scrubSecrets(error.message, ctx.secrets) || 'The model does not take pictures');
    } else {
      failProvider(steps.image, error, ctx.secrets);
    }
  }

  private checkUsage(steps: Steps, reply: AiAdapterResult): void {
    if (reply.usageReported) pass(steps.usage);
    else fail(steps.usage, 'no-usage', 'The provider reported no token usage, so costs cannot be counted');
  }

  /** Sends one test request and records it in the ledger, since it costs like any other. */
  private async sendRecorded(ctx: TestContext, request: AiHttpRequest, model: string): Promise<AiHttpResponse> {
    const at = new Date();
    ctx.attempt++;
    let response: AiHttpResponse | null = null;
    let outcome: AiUsageOutcome = 'error:provider-down';
    let reply: AiAdapterResult | null = null;
    try {
      response = await ctx.send(request);
      reply = response.status < 300 ? ctx.adapter.parseResponse(response) : null;
      outcome = reply ? (reply.finish === 'stop' ? 'ok' : reply.finish) : response.status === 429 ? 'rate-limited' : 'error:bad-request';
      return response;
    } catch (err) {
      if (err instanceof AiNetworkError && err.failure === 'timeout') outcome = 'timeout';
      throw err;
    } finally {
      const usage = reply?.usage;
      const cost = usage?.cost ?? (usage && ctx.prices ? (usage.input * ctx.prices.input + usage.output * ctx.prices.output) / 1_000_000 : null);
      await this.ledger
        .insert({
          at,
          month: aiMonthKey(at),
          feature: AI_TEST_USAGE_FEATURE,
          slot: 'test',
          connectionId: ctx.connection.id,
          model,
          inputTokens: usage?.input ?? 0,
          outputTokens: usage?.output ?? 0,
          reasoningTokens: usage?.reasoning ?? 0,
          cachedTokens: usage?.cached ?? 0,
          costMicros: cost === null ? null : toMicros(cost),
          durationMs: response?.durationMs ?? Date.now() - at.getTime(),
          outcome,
          jobId: null,
          attempt: ctx.attempt,
        })
        .catch((err: unknown) =>
          this.logger.error(`[ai-test] [ledger] - Could not record usage: ${sanitizeLogValue(err instanceof Error ? err.message : String(err))}`),
        );
    }
  }

  /** Marks the key row failed for an error that is about the key or the account; true if it was. */
  private keyFailure(steps: Steps, error: AiProviderError, secrets: string[]): boolean {
    const message = scrubSecrets(error.message, secrets);
    if (error.kind === 'auth') fail(steps.key, 'key-rejected', message || 'The provider rejected the key');
    else if (error.kind === 'credit') fail(steps.key, 'out-of-credit', message || 'The provider account is out of credit');
    else if (error.kind === 'spend-limit') fail(steps.key, 'spend-limit', message || 'The provider account reached its spend limit');
    else return false;
    return true;
  }

  /** Prices to count the test's cost with: the slot's for this model, else the model list's. */
  private async pricesFor(connectionId: number | null, model: string, models: AiModelList | null): Promise<AiModelPrices | null> {
    if (connectionId !== null) {
      const slots = await this.settings.slots();
      const slot = Object.values(slots).find((entry) => entry.connectionId === connectionId && entry.model === model && entry.prices);
      if (slot?.prices) return slot.prices;
    }
    return models?.models.find((entry) => entry.id === model)?.prices ?? null;
  }

  private async clearSlotHealth(connectionId: number, model: string | null): Promise<void> {
    if (!model) return;
    const [slots, health] = await Promise.all([this.settings.slots(), this.settings.slotHealth()]);
    for (const [slot, entry] of Object.entries(health)) {
      const name = slot as keyof typeof slots;
      if (entry?.model === model && slots[name].connectionId === connectionId && slots[name].model === model) {
        await this.settings.setSlotHealth(name, null);
        this.events.emit(AI_EVENTS.SLOT_HEALTHY, { slot: name } satisfies AiSlotHealthyEvent);
      }
    }
  }

  /** A saved connection that cannot be tried at all, such as one whose key no longer decrypts. */
  private blocked(baseUrl: string, model: string | null, failure: AiFailureCode, message: string): AiConnectionTestResult {
    const steps = Object.fromEntries(AI_TEST_STEPS.map((id) => [id, { id, ok: null }])) as Steps;
    fail(failure === 'key-unreadable' ? steps.key : steps.reach, failure, message);
    return {
      at: new Date().toISOString(),
      ok: false,
      host: hostOf(baseUrl),
      model,
      steps: AI_TEST_STEPS.map((id) => steps[id]),
      jsonSupport: null,
      modelCount: null,
      models: null,
    };
  }
}

/** The test as stored on the connection: without the model list, which can run to hundreds. */
function storedTest(result: AiConnectionTestResult): AiConnectionTest {
  return {
    at: result.at,
    ok: result.ok,
    host: result.host,
    model: result.model,
    steps: result.steps,
    jsonSupport: result.jsonSupport,
    modelCount: result.modelCount,
  };
}

function pass(step: AiTestStep, extra: Partial<AiTestStep> = {}): void {
  Object.assign(step, extra, { ok: true });
}

function fail(step: AiTestStep, code: AiFailureCode, message: string, extra: Partial<AiTestStep> = {}): void {
  Object.assign(step, extra, { ok: false, code, message });
}

function failNetwork(step: AiTestStep, error: AiNetworkError, secrets: string[]): void {
  fail(step, error.failure, scrubSecrets(error.message, secrets), error.extra.location ? { location: error.extra.location } : {});
}

function failProvider(step: AiTestStep, error: AiProviderError, secrets: string[]): void {
  const message = scrubSecrets(error.message, secrets);
  switch (error.kind) {
    case 'model-missing':
      return fail(step, 'model-missing', message || 'Model not found');
    case 'rate-limited': {
      const wait = error.retryAfterSeconds;
      return fail(
        step,
        'rate-limited',
        wait ? `The provider limited requests; try again in ${wait} s` : 'The provider limited requests; try again later',
        {
          ...(wait !== undefined ? { retryAfterSeconds: wait } : {}),
        },
      );
    }
    case 'not-api':
      return fail(step, 'web-page', 'This URL answered with a web page, not an API');
    case 'endpoint-missing':
      return fail(step, 'provider-error', 'The provider has no such API at this URL; check the URL and the API type');
    default:
      return fail(step, 'provider-error', message ? `The provider answered ${error.status}: ${message}` : `The provider answered ${error.status}`);
  }
}

/** True when the reply names a title from the drawn covers. */
function readsSample(value: unknown): boolean {
  const titles = (value as { titles?: unknown } | null)?.titles;
  if (!Array.isArray(titles)) return false;
  return titles.some(
    (title) =>
      typeof title === 'string' &&
      AI_VISION_SAMPLE_TITLES.some((sample) =>
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .includes(sample),
      ),
  );
}

function firstTextModel(models: AiModelList | null): string | null {
  if (!models?.listed) return null;
  return (models.models.find((model) => !NOT_TEXT_MODEL.test(model.id)) ?? models.models[0])?.id ?? null;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
