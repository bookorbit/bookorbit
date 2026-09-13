import { MetadataCandidate } from '@bookorbit/types';

import { htmlToPlainText } from '../../../common/utils/html-to-text.utils';
import { ProviderThrottleError } from '../provider-throttle.error';
import { MetadataSearchParams } from './metadata-search-params';

export function allowsAudiobookProviders(params: MetadataSearchParams): boolean {
  return params.includeAudiobookProviders ?? params.isAudiobook ?? false;
}

export function normalizeMaxCandidates(value: number | undefined, maxResults: number): number {
  if (!Number.isFinite(value) || value == null) return maxResults;
  const rounded = Math.floor(value);
  if (rounded < 1) return 1;
  return Math.min(rounded, maxResults);
}

export function buildRequestSignal(timeoutMs: number, parentSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!parentSignal) return timeoutSignal;
  if (parentSignal.aborted) return parentSignal;
  return AbortSignal.any([timeoutSignal, parentSignal]);
}

export interface SearchDeadline {
  /** Epoch ms the budget runs out. */
  readonly at: number;
  /** Aborts in-flight work when the budget runs out, so partial results survive. */
  readonly signal: AbortSignal;
  expired(): boolean;
  dispose(): void;
}

/**
 * Budget for a search that spans many calls. The hard provider timeout throws the whole search
 * away; this one cancels what is still running and leaves the caller holding what it already has,
 * so it has to sit far enough below the hard timeout for the caller to finish assembling results.
 */
export function createSearchDeadline(budgetMs: number, parentSignal?: AbortSignal): SearchDeadline {
  const at = Date.now() + budgetMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;

  return {
    at,
    signal,
    expired: () => Date.now() >= at,
    dispose: () => clearTimeout(timer),
  };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Rethrows a throttle raised part-way through a per-result loop with the candidates gathered so far
 * attached, so recording the cooldown does not also discard finished work. Anything else, and a
 * throttle that already carries candidates from an inner loop, is rethrown untouched.
 */
export function rethrowWithPartialCandidates(error: unknown, candidates: readonly MetadataCandidate[]): never {
  if (error instanceof ProviderThrottleError && candidates.length > 0 && error.partialCandidates.length === 0) {
    throw new ProviderThrottleError(error.retryAfterSeconds, error.reason, [...candidates]);
  }
  throw error;
}

export function stripHtml(html: string): string {
  return htmlToPlainText(html);
}

export function sanitizeLogError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

function createAbortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}
