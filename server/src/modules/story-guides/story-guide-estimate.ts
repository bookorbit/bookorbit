import type { AiJobEstimate, AiModelPrices, AiSlot } from '@bookorbit/types';

import { AI_JOBS_UNIT_CONCURRENCY } from '../ai-jobs/ai-jobs.constants';
import { PASSAGE_CHARS } from './pipeline/text-step';
import { LONG_SECTION_WORDS, SECTION_PART_WORDS } from './text/section-parts';

interface ProseShape {
  /** Characters per word in the text the `text` step cuts. */
  charsPerWord: number;
  /** Tokens per word, as the providers' tokenizers count it. */
  tokensPerWord: number;
}

/**
 * English measured on the golden books. Spanish on Marianela and El sombrero de tres picos, whose
 * passage calls read about 1.46 times the tokens per word of English books on the same model.
 */
const PROSE: Readonly<Record<string, ProseShape>> = {
  en: { charsPerWord: 5.4, tokensPerWord: 1.33 },
  es: { charsPerWord: 5.9, tokensPerWord: 1.9 },
};

function proseOf(language: string | null | undefined): ProseShape {
  return (language && PROSE[language]) || PROSE.en;
}

/**
 * What a model call reads and writes, per step, measured on the six builds of the golden books
 * (Harry Potter 1, Threshing Day, Closer to Home, each built and rebuilt) at medium effort.
 *
 * Passages are cut to about the same length, so a call's tokens barely move with the book: what a
 * step costs is its number of calls. `callOut` counts every token the model writes, reasoning
 * included, which is about four fifths of it. A passage call also reads its passage, so the story
 * is read once by `names` and once by `ties` on top of `callIn`.
 */
interface StepCost {
  slot: AiSlot;
  /** One call per passage, per unit of the `lines` step (a chapter, or a part of a long one), or one for the book. */
  unit: 'passage' | 'lines' | 'book';
  /** Input tokens per token of story the step reads. */
  read: number;
  /** Input and output tokens per call. */
  callIn: number;
  callOut: number;
}

export const STORY_GUIDE_STEP_COSTS: Record<string, StepCost> = {
  names: { slot: 'fast', unit: 'passage', read: 1, callIn: 700, callOut: 2_800 },
  review: { slot: 'careful', unit: 'book', read: 0, callIn: 7_000, callOut: 3_700 },
  ties: { slot: 'fast', unit: 'passage', read: 1, callIn: 700, callOut: 1_500 },
  lines: { slot: 'fast', unit: 'lines', read: 0, callIn: 2_800, callOut: 1_650 },
  profiles: { slot: 'fast', unit: 'lines', read: 1, callIn: 1_500, callOut: 3_000 },
  /**
   * Two chapters of Through the Looking-Glass on GPT-6 Luna: the prompt and the summary before it
   * on top of the chapter, and 70 to 110 tokens of summary out, with room for a model that reasons.
   * Not yet measured on the golden books.
   */
  summaries: { slot: 'fast', unit: 'lines', read: 1, callIn: 600, callOut: 500 },
};

/**
 * Milliseconds one unit of a step takes in one lane, learned from finished builds on the model the
 * step would use. A step with none leaves the time unknown.
 */
export type StoryGuideStepRates = Partial<Record<string, number | null>>;

export interface StoryGuideEstimateInput {
  /** The story sections, with the words the key job counted in each. */
  sections: readonly { words: number }[];
  /** The book's language; English when absent. */
  language?: string | null;
  /** The steps that run; the others reuse cached units. */
  steps: readonly string[];
  prices: Partial<Record<AiSlot, AiModelPrices | null>>;
  rates: StoryGuideStepRates;
}

export interface StoryGuideProgressInput {
  sections: readonly { words: number }[];
  language?: string | null;
  /** Every step of the pipeline, in the order the runner goes through them. */
  order: readonly string[];
  /** The steps that run; the others reuse cached units. */
  steps: readonly string[];
  rates: StoryGuideStepRates;
  /** The step running now and its counts; a null phase is a job that has not started a step. */
  phase: string | null;
  done: number;
  total: number;
}

/** Passages the `text` step cuts: each section ends a passage, and a passage holds about 9,000 characters. */
export function estimatedPassages(sections: readonly { words: number }[], language?: string | null): number {
  const passageWords = PASSAGE_CHARS / proseOf(language).charsPerWord;
  const passages = sections.reduce((total, section) => total + Math.max(1, Math.ceil(section.words / passageWords)), 0);
  return Math.max(1, passages);
}

/** Units of the `lines` step: a section, or the parts a long section is cut into. */
export function estimatedLinesUnits(sections: readonly { words: number }[]): number {
  const units = sections.reduce(
    (total, section) => total + (section.words > LONG_SECTION_WORDS ? Math.max(2, Math.round(section.words / SECTION_PART_WORDS)) : 1),
    0,
  );
  return Math.max(1, units);
}

function unitCounts(sections: readonly { words: number }[], language?: string | null): Record<StepCost['unit'], number> {
  return { passage: estimatedPassages(sections, language), lines: estimatedLinesUnits(sections), book: 1 };
}

/**
 * How long `units` of a step take at `rate`. Passage units run side by side as the runner does
 * them, up to its limit; `lines` units chain chapter to chapter and the review is one call.
 */
function stepMs(shape: StepCost, units: number, rate: number): number {
  if (units <= 0) return 0;
  const lanes = shape.unit === 'passage' ? Math.min(AI_JOBS_UNIT_CONCURRENCY, units) : 1;
  return (units * rate) / lanes;
}

function toMinutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** Dollars and minutes for a build, from the story's sections, the slots' prices and the models' learned speed. */
export function estimateStoryGuide(input: StoryGuideEstimateInput): AiJobEstimate {
  const words = input.sections.reduce((total, section) => total + section.words, 0);
  const storyTokens = words * proseOf(input.language).tokensPerWord;
  const calls = unitCounts(input.sections, input.language);

  let cost: number | null = 0;
  let ms: number | null = 0;
  let modelSteps = 0;
  for (const step of input.steps) {
    const shape = STORY_GUIDE_STEP_COSTS[step];
    if (!shape) continue;
    modelSteps++;
    const count = calls[shape.unit];
    const rate = input.rates[step];
    if (rate == null) ms = null;
    else if (ms !== null) ms += stepMs(shape, count, rate);
    const prices = input.prices[shape.slot];
    if (!prices) cost = null;
    else if (cost !== null) {
      const tokensIn = storyTokens * shape.read + shape.callIn * count;
      cost += (tokensIn * prices.input + shape.callOut * count * prices.output) / 1_000_000;
    }
  }
  const minutes = modelSteps === 0 ? 0 : ms === null ? null : toMinutes(ms);
  return { words, minutes, cost: cost === null ? null : Math.round(cost * 10_000) / 10_000 };
}

/**
 * Minutes a running build has left: the units the current step still has, then every later step
 * in full. Null while a step still to run has no learned speed.
 */
export function storyGuideMinutesLeft(input: StoryGuideProgressInput): number | null {
  const calls = unitCounts(input.sections, input.language);
  const runs = new Set(input.steps);
  const current = input.phase === null ? -1 : input.order.indexOf(input.phase);
  let ms = 0;
  for (const [index, step] of input.order.entries()) {
    if (index < current || (index > current && !runs.has(step))) continue;
    const shape = STORY_GUIDE_STEP_COSTS[step];
    if (!shape) continue;
    const units = index === current ? Math.max(0, input.total - input.done) : calls[shape.unit];
    if (units === 0) continue;
    const rate = input.rates[step];
    if (rate == null) return null;
    ms += stepMs(shape, units, rate);
  }
  return toMinutes(ms);
}
