import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';

import {
  READING_HELP_MAX_TOTAL_LENGTH,
  READING_HELP_PASSAGE_TOKENS,
  type AiSlot,
  type ReadingHelpAppInfo,
  type ReadingHelpErrorCode,
  type ReadingHelpEvent,
  type ReadingHelpKind,
  type ReadingHelpRequest,
} from '@bookorbit/types';

import { SystemCron } from '../../common/decorators/system-cron.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AiBudgetService, toMicros } from '../ai/ai-budget.service';
import { AiClient } from '../ai/ai-client.service';
import { isAiError, type AiSlotChoice } from '../ai/ai-client.types';
import { AiLedgerRepository } from '../ai/ai-ledger.repository';
import { aiMonthKey } from '../ai/ai-month';
import { AiSettingsService, type AiSettingsSnapshot } from '../ai/ai-settings.service';
import { BookService } from '../book/book.service';
import { READING_HELP_PROMPT_VERSIONS, answerLanguage, cappedAnswer, cleanAnswer, readingHelpPrompt } from './reading-help-prompts';
import { ReadingHelpCacheRepository } from './reading-help-cache.repository';

export const READING_HELP_FEATURE = 'reading-help';
/** The events of one answer: a cached answer is all there at once, a written one arrives as it is written. */
export type ReadingHelpAnswer = Iterable<ReadingHelpEvent> | AsyncIterable<ReadingHelpEvent>;
/** How long an answer may take, retries included. Careful models think before they write. */
export const READING_HELP_FAST_TIMEOUT_MS = 45_000;
export const READING_HELP_CAREFUL_TIMEOUT_MS = 120_000;
/** Room for a reasoning model's thinking; the sentence cap ends the answer long before. */
const FAST_MAX_OUTPUT_TOKENS = 2_000;
const CAREFUL_MAX_OUTPUT_TOKENS = 6_000;
/** Cached answers unused this long are removed, and the rest are kept within this size. */
const CACHE_UNUSED_DAYS = 180;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** A recap reads one stretch of pages; the other kinds read passages gathered across the book. */
const ONE_PASSAGE_KINDS: readonly ReadingHelpKind[] = ['recap-note', 'recap-stop'];

export function readingHelpError(code: ReadingHelpErrorCode, message: string): HttpException {
  const body = { message, errorCode: code };
  switch (code) {
    case 'READING_HELP_OFF':
    case 'READING_HELP_BUDGET':
      return new ForbiddenException(body);
    case 'READING_HELP_CAREFUL_OFF':
      return new ConflictException(body);
    case 'READING_HELP_READER_CAP':
      return new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
    case 'READING_HELP_REFUSED':
    case 'READING_HELP_TOO_LONG':
      return new UnprocessableEntityException(body);
    case 'READING_HELP_TIMEOUT':
      return new GatewayTimeoutException(body);
    default:
      return new BadGatewayException(body);
  }
}

/** What an answer is keyed by in the shared cache: everything that shapes it, nothing about who asked. */
export function readingHelpCacheKey(request: ReadingHelpRequest, choice: Pick<AiSlotChoice, 'slot' | 'connectionId' | 'model'>): string {
  const parts = {
    feature: READING_HELP_FEATURE,
    kind: request.kind,
    version: READING_HELP_PROMPT_VERSIONS[request.kind],
    slot: choice.slot,
    connectionId: choice.connectionId,
    model: choice.model,
    language: request.language.toLowerCase(),
    term: request.term ?? null,
    scope: request.scope ?? 'book',
    passages: request.passages,
  };
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * Reading help: short answers about passages the app chose from before the reader's page, written
 * by the admin's Fast model (or Careful, when the reader asks again more carefully) and streamed
 * back. Answers are shared through a cache keyed by their inputs, and each reader has a monthly cap
 * on top of the feature's budget.
 */
@Injectable()
export class ReadingHelpService {
  private readonly logger = new Logger(ReadingHelpService.name);

  constructor(
    private readonly ai: AiClient,
    private readonly settings: AiSettingsService,
    private readonly budget: AiBudgetService,
    private readonly ledger: AiLedgerRepository,
    private readonly cache: ReadingHelpCacheRepository,
    private readonly books: BookService,
  ) {}

  /** In `app-info`: on when the admin turned the feature on and the Fast slot has a model. */
  async appInfo(): Promise<ReadingHelpAppInfo> {
    const [features, slots] = await Promise.all([this.settings.features(), this.settings.slots()]);
    return {
      enabled: features[READING_HELP_FEATURE].enabled && hasModel(slots.fast),
      careful: hasModel(slots.careful),
      passageTokens: READING_HELP_PASSAGE_TOKENS,
    };
  }

  /**
   * Checks everything that can be checked before an answer starts, throwing an `HttpException` the
   * caller sends as a JSON error, then returns the answer's events. `signal` aborts when the app
   * hangs up, which stops the model too.
   */
  async answer(user: RequestUser, request: ReadingHelpRequest, signal: AbortSignal): Promise<ReadingHelpAnswer> {
    checkShape(request);
    const snapshot = await this.settings.snapshot();
    const feature = snapshot.features[READING_HELP_FEATURE];
    if (!feature.enabled || !hasModel(snapshot.slots.fast)) throw readingHelpError('READING_HELP_OFF', 'Reading help is turned off on this server');
    const careful = request.careful === true;
    if (careful && !hasModel(snapshot.slots.careful)) throw readingHelpError('READING_HELP_CAREFUL_OFF', 'No careful model is set on this server');

    await this.books.verifyFileAccess(request.fileId, user);

    const slot: AiSlot = careful ? 'careful' : 'fast';
    const choice = await this.ai.resolveSlot(slot, snapshot);
    const keyHash = readingHelpCacheKey(request, choice);
    const cached = await this.cache.take(keyHash);
    if (cached !== null) {
      this.logger.log(
        `[reading_help.answer] [end] userId=${user.id} fileId=${request.fileId} kind=${request.kind} careful=${careful} cached=true durationMs=0 - answered from the cache`,
      );
      return [{ type: 'done', text: cached, cached: true, careful }];
    }

    await this.checkReaderCap(user, snapshot, choice);
    try {
      await this.budget.checkRequest({ feature: READING_HELP_FEATURE, worstCaseMicros: null });
    } catch (error) {
      if (isAiError(error) && error.code === 'budget') throw readingHelpError('READING_HELP_BUDGET', "This month's AI budget is used up");
      throw error;
    }
    return this.write(user, request, choice, keyHash, signal);
  }

  /** Clears answers nobody used for half a year, then the oldest used until the cache fits its size. */
  @SystemCron(CronExpression.EVERY_6_HOURS)
  async sweepCache(): Promise<void> {
    const startedAt = Date.now();
    try {
      const before = new Date(Date.now() - CACHE_UNUSED_DAYS * 24 * 60 * 60 * 1000);
      const { expired, evicted } = await this.cache.sweep(before, CACHE_MAX_BYTES);
      if (expired + evicted > 0) {
        this.logger.log(
          `[reading_help.cache] [end] expired=${expired} evicted=${evicted} durationMs=${Date.now() - startedAt} - swept the answer cache`,
        );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[reading_help.cache] [fail] durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - could not sweep the answer cache`,
      );
    }
  }

  /** Dollars when the slot has prices, else requests: what one reader may use this month. */
  private async checkReaderCap(user: RequestUser, snapshot: AiSettingsSnapshot, choice: AiSlotChoice): Promise<void> {
    const settings = snapshot.features[READING_HELP_FEATURE];
    const dollars = settings.readerMonthlyBudget ?? null;
    const requests = settings.readerRequestsPerMonth ?? null;
    const priced = choice.prices !== null;
    if ((priced && dollars === null) || (!priced && requests === null)) return;

    const spend = await this.ledger.readerSpend(aiMonthKey(new Date()), READING_HELP_FEATURE, user.id);
    const over = priced ? spend.costMicros >= toMicros(dollars as number) : spend.requests >= (requests as number);
    if (over) throw readingHelpError('READING_HELP_READER_CAP', "This month's share of reading help is used up");
  }

  private async *write(
    user: RequestUser,
    request: ReadingHelpRequest,
    choice: AiSlotChoice,
    keyHash: string,
    hangUp: AbortSignal,
  ): AsyncGenerator<ReadingHelpEvent, void, undefined> {
    const careful = choice.slot === 'careful';
    const startedAt = Date.now();
    const prompt = readingHelpPrompt({
      kind: request.kind,
      language: answerLanguage(request.language),
      term: request.term,
      scope: request.scope ?? 'book',
      passages: request.passages,
    });
    const timeout = AbortSignal.timeout(careful ? READING_HELP_CAREFUL_TIMEOUT_MS : READING_HELP_FAST_TIMEOUT_MS);
    const signal = AbortSignal.any([timeout, hangUp]);
    const cap = (text: string) => cappedAnswer(text, prompt.maxSentences, request.language);
    const head = `userId=${user.id} fileId=${request.fileId} kind=${request.kind} careful=${careful}`;
    this.logger.log(`[reading_help.answer] [start] ${head} passages=${request.passages.length} - writing an answer`);

    let text = '';
    let shown = '';
    try {
      for await (const event of this.ai.stream(
        {
          feature: READING_HELP_FEATURE,
          slot: choice.slot,
          use: choice,
          system: prompt.system,
          user: prompt.user,
          maxOutputTokens: careful ? CAREFUL_MAX_OUTPUT_TOKENS : FAST_MAX_OUTPUT_TOKENS,
          effort: careful ? 'medium' : 'low',
          signal,
          userId: user.id,
        },
        { stopWhen: (sofar) => cap(sofar) !== null },
      )) {
        if ('delta' in event) {
          text += event.delta;
          const visible = cap(text) ?? text;
          if (visible.length > shown.length && visible.startsWith(shown)) {
            yield { type: 'delta', text: visible.slice(shown.length) };
            shown = visible;
          }
          continue;
        }

        const result = event.done;
        if (result.finish === 'refused' || result.finish === 'filtered') {
          this.logger.warn(
            `[reading_help.answer] [fail] ${head} durationMs=${Date.now() - startedAt} code=READING_HELP_REFUSED - the model declined`,
          );
          yield errorEvent('READING_HELP_REFUSED', 'The model declined these passages');
          return;
        }
        const answer = cleanAnswer(cap(text) ?? (text || result.text));
        if (!answer) {
          yield errorEvent('READING_HELP_PROVIDER', 'The model sent an empty answer');
          return;
        }
        if (result.finish === 'stop') await this.remember(keyHash, request, answer);
        this.logger.log(
          `[reading_help.answer] [end] ${head} cached=false finish=${result.finish} durationMs=${Date.now() - startedAt} - answer written`,
        );
        yield { type: 'done', text: answer, cached: false, careful };
      }
    } catch (error) {
      if (hangUp.aborted && !timeout.aborted) {
        this.logger.log(`[reading_help.answer] [end] ${head} cancelled=true durationMs=${Date.now() - startedAt} - the app hung up`);
        return;
      }
      const code = errorCode(error, timeout);
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[reading_help.answer] [fail] ${head} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} code=${code} error="${sanitizeLogValue(err.message)}" - answer failed`,
      );
      yield errorEvent(code, messageFor(code));
    }
  }

  private async remember(keyHash: string, request: ReadingHelpRequest, answer: string): Promise<void> {
    try {
      await this.cache.put({ keyHash, feature: READING_HELP_FEATURE, kind: request.kind, answer });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[reading_help.cache] [fail] errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - could not cache an answer`,
      );
    }
  }
}

function hasModel(slot: { connectionId: number | null; model: string | null }): boolean {
  return slot.connectionId !== null && slot.model !== null;
}

/** What the DTO cannot say: which fields each kind needs, and the passages' size together. */
function checkShape(request: ReadingHelpRequest): void {
  if ((request.kind === 'term' || request.kind === 'description') && !request.term?.trim()) {
    throw new BadRequestException('A term or description needs the term asked about');
  }
  if (ONE_PASSAGE_KINDS.includes(request.kind) && request.passages.length !== 1) {
    throw new BadRequestException('A recap note or stop carries exactly one passage');
  }
  const total = request.passages.reduce((sum, passage) => sum + passage.length, 0);
  if (total > READING_HELP_MAX_TOTAL_LENGTH) throw new BadRequestException('The passages are longer than one answer reads');
}

function errorEvent(errorCode: ReadingHelpErrorCode, message: string): ReadingHelpEvent {
  return { type: 'error', errorCode, message };
}

function errorCode(error: unknown, timeout: AbortSignal): ReadingHelpErrorCode {
  if (!isAiError(error)) return 'READING_HELP_PROVIDER';
  switch (error.code) {
    case 'off':
    case 'slot-empty':
      return 'READING_HELP_OFF';
    case 'budget':
      return 'READING_HELP_BUDGET';
    case 'too-long':
      return 'READING_HELP_TOO_LONG';
    case 'cancelled':
      return timeout.aborted ? 'READING_HELP_TIMEOUT' : 'READING_HELP_PROVIDER';
    default:
      return 'READING_HELP_PROVIDER';
  }
}

function messageFor(code: ReadingHelpErrorCode): string {
  switch (code) {
    case 'READING_HELP_OFF':
      return 'Reading help is turned off on this server';
    case 'READING_HELP_BUDGET':
      return "This month's AI budget is used up";
    case 'READING_HELP_TOO_LONG':
      return 'The passages do not fit the model';
    case 'READING_HELP_TIMEOUT':
      return 'The AI provider took too long to answer';
    default:
      return 'The AI provider could not answer';
  }
}
