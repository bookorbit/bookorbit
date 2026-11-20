import type { AiRunContext } from '../../ai-jobs/ai-feature';
import type { StoryMergeResult, StoryNamesResult, StoryReviewResult } from './story-guide.types';
import type { StoryPassage, TextStepResult } from './text-step';

type Results = Pick<AiRunContext, 'results'>;

/** The `text` step's chapters and passages. */
export function textResult(ctx: Results): TextStepResult {
  return only<TextStepResult>(ctx, 'text', 'book');
}

/** Each passage's `names` result, by passage id. A passage left out has none. */
export function namesResults(ctx: Results): Map<string, StoryNamesResult> {
  return new Map([...ctx.results('names')].map(([id, value]) => [id, value as StoryNamesResult]));
}

export function mergeResult(ctx: Results): StoryMergeResult {
  return only<StoryMergeResult>(ctx, 'merge', 'book');
}

export function reviewResult(ctx: Results): StoryReviewResult {
  return only<StoryReviewResult>(ctx, 'review', 'cast');
}

export function passageById(text: TextStepResult, id: string): StoryPassage {
  const passage = text.passages.find((item) => item.id === id);
  if (!passage) throw new Error(`No passage ${id}`);
  return passage;
}

/** Each passage's place in reading order. */
export function passageOrder(text: Pick<TextStepResult, 'passages'>): Map<string, number> {
  return new Map(text.passages.map((passage, index) => [passage.id, index]));
}

function only<T>(ctx: Results, step: string, unit: string): T {
  const value = ctx.results(step).get(unit) as T | undefined;
  if (value === undefined) throw new Error(`The ${step} step has no result`);
  return value;
}
