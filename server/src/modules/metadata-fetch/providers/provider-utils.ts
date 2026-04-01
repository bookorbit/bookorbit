const HTML_ENTITY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
];

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

export function stripHtml(html: string): string {
  let value = html.replace(/<[^>]*>/g, ' ');
  for (const [pattern, replacement] of HTML_ENTITY_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value.replace(/\s+/g, ' ').trim();
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
