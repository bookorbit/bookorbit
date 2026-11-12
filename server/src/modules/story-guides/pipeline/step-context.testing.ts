import type { StoryGuideEntityKind } from '@bookorbit/types';

import type { AiStepContext, AiStepRequest } from '../../ai-jobs/ai-feature';
import { locateName } from './name-text';
import type { StoryGuideSubject } from './story-guide-subject';
import type { PassageSpan, StoryNamesResult } from './story-guide.types';
import type { StoryChapter, StoryPassage, TextStepResult } from './text-step';

/** A step context with saved results and scripted replies, for running a step's `run` with no model. */
export interface FakeStepContext extends AiStepContext<StoryGuideSubject> {
  requests: AiStepRequest[];
}

/**
 * `results` are by step id, then unit id. `reply` answers each request in turn; an Error it returns
 * is thrown from `complete`, the way the client throws.
 */
export function fakeStepContext(
  results: Record<string, Record<string, unknown>>,
  reply: (request: AiStepRequest, index: number) => string | Error = () => '{}',
  subject: Partial<StoryGuideSubject> = {},
): FakeStepContext {
  const requests: AiStepRequest[] = [];
  return {
    requests,
    job: { id: 'job', feature: 'story-guide', kind: 'build', subjectKey: 'key', subjectRef: { type: 'book-file', id: 1 }, generation: 1, models: {} },
    subject: { key: 'key', title: 'A Book', authors: ['Some Author'], ...subject } as StoryGuideSubject,
    results: (step) => new Map(Object.entries(results[step] ?? {})),
    skipped: () => new Map(),
    signal: new AbortController().signal,
    step: 'test',
    model: 'test-model',
    complete(request) {
      requests.push(request);
      const answer = reply(request, requests.length - 1);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ text: answer, usage: { input: 0, output: 0 }, finish: 'stop', model: 'test-model' });
    },
  } as FakeStepContext;
}

/**
 * A `text` result from passage texts by chapter. Raw offsets are the passages laid end to end; a
 * chapter given `parts` (passage counts) is a long one with that many lines-step parts.
 */
export function syntheticText(chapters: readonly (readonly string[])[], parts: Record<number, readonly number[]> = {}): TextStepResult {
  const passages: StoryPassage[] = [];
  const result: StoryChapter[] = [];
  let at = 0;
  chapters.forEach((texts, index) => {
    const number = index + 1;
    const start = at;
    const ends: number[] = [];
    texts.forEach((text, part) => {
      passages.push({ id: `c${number}p${part + 1}`, chapter: number, part: part + 1, s: index, start: at, end: at + text.length, text });
      at += text.length;
      ends.push(at);
    });
    const counts = parts[number] ?? [texts.length];
    let from = start;
    let taken = 0;
    const chapterParts = counts.map((count, part) => {
      taken += count;
      const end = ends[taken - 1];
      const item = { part: part + 1, start: from, end };
      from = end;
      return item;
    });
    result.push({ number, s: index, title: null, start, end: at, lines: [], parts: chapterParts });
  });
  return { key: 'synthetic', chapters: result, passages };
}

/** An entry for `syntheticNames`: name, aliases, kind and what, the last three optional. */
export type SyntheticEntry = [name: string, aliases?: string[], kind?: StoryGuideEntityKind, what?: string];

/** `names` results for a synthetic text, each name located in its passage. A name the passage lacks throws. */
export function syntheticNames(
  text: TextStepResult,
  byPassage: Record<string, readonly SyntheticEntry[]>,
  narrators: Record<string, string> = {},
): Map<string, StoryNamesResult> {
  const results = new Map<string, StoryNamesResult>();
  for (const passage of text.passages) {
    const entries = byPassage[passage.id];
    if (!entries) continue;
    results.set(passage.id, {
      passage: passage.id,
      chapter: passage.chapter,
      part: passage.part,
      narrator: narrators[passage.id] ?? null,
      entries: entries.map(([name, aliases = [], kind = 'character', what = '']) => {
        const at: Record<string, PassageSpan> = {};
        for (const item of [name, ...aliases]) {
          const found = locateName(passage.text, item);
          if (!found) throw new Error(`${item} is not in ${passage.id}`);
          at[item] = { passage: passage.id, ...found };
        }
        return { name, aliases, kind, what, at };
      }),
    });
  }
  return results;
}
