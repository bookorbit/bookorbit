import { readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';

import { STORY_TEXT_EXTRACTION_VERSION } from '../text/extraction-version';
import { extractBookText } from '../text/foliate-book-text';
import { storySections, storyTextKey } from '../text/story-sections';
import type { BookText } from '../text/book-text.types';
import { textStep, type TextStepResult } from '../pipeline/text-step';

export const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures');

/** One public-domain run of the reference pipeline (`test-fixtures/README.md`). Offsets are into its own text. */
export interface LabRun {
  book: { title: string; author: string; source: string };
  models: { steps: string; review: string; effort: string };
  units: { unit: number; chapter: number; part: number; start: number; end: number }[];
  names: Record<string, LabNames>;
  review: { groups: { ids: number[]; from: number; model_from: unknown }[]; raw: string };
  final: unknown[];
  placement: Record<string, Record<string, number>>;
  ties: Record<string, { chapter: number; kept: Record<string, unknown>[]; dropped: Record<string, unknown>[] }>;
  lines: Record<string, { chapter: number; end: number; lines: Record<string, string> }>;
  relations: Record<string, unknown>[];
  payload: unknown;
}

export interface LabNames {
  unit: number;
  chapter: number;
  part: number;
  narrator: string | null;
  entries: { name: string; aliases: string[]; kind: string; what: string }[];
  raw: string;
}

export function labRun(name = 'a-study-in-scarlet'): LabRun {
  return JSON.parse(gunzipSync(readFileSync(join(FIXTURES_DIR, 'public-domain', `${name}.steps.json.gz`))).toString('utf8')) as LabRun;
}

let cached: Promise<{ book: BookText; text: TextStepResult }> | null = null;

/** The server's `text` step over the public-domain EPUB, read once per test file. */
export function publicDomainText(): Promise<{ book: BookText; text: TextStepResult }> {
  cached ??= (async () => {
    const book = await extractBookText(join(FIXTURES_DIR, 'a-study-in-scarlet.epub'));
    const sections = storySections(book);
    return { book, text: textStep(book, sections, storyTextKey(book, sections, STORY_TEXT_EXTRACTION_VERSION)) };
  })();
  return cached;
}
