import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AiHttpResponse } from '../../ai-network';

interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** A provider response as recorded: `<api-type>/<case>.json` with status, headers and body. */
export function loadFixture(apiType: string, name: string): AiHttpResponse {
  const recorded = JSON.parse(readFileSync(join(__dirname, apiType, `${name}.json`), 'utf8')) as RecordedResponse;
  return {
    status: recorded.status,
    headers: new Headers(recorded.headers),
    text: typeof recorded.body === 'string' ? recorded.body : JSON.stringify(recorded.body),
    durationMs: 120,
  };
}
