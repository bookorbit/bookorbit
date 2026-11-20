import { STORY_GUIDE_TIMED_STEPS } from '@bookorbit/types';

import { AI_JOBS_UNIT_CONCURRENCY } from '../ai-jobs/ai-jobs.constants';
import {
  estimatedLinesUnits,
  estimatedPassages,
  estimateStoryGuide,
  STORY_GUIDE_STEP_COSTS,
  storyGuideMinutesLeft,
  type StoryGuideStepRates,
} from './story-guide-estimate';
import { publicDomainText } from './testing/story-guide-fixtures';
import { storySections } from './text/story-sections';

/** The prices the builds were costed at: GPT-6 Luna on the passage steps, GPT-6.1 Terra on the review. */
const PRICES = { fast: { input: 0.1, output: 0.5 }, careful: { input: 1, output: 5 } };
const ALL_STEPS = ['text', 'names', 'merge', 'review', 'ties', 'lines'];
/** A minute per unit in one lane on every model step. */
const MINUTE = 60_000;
const RATES: StoryGuideStepRates = { names: MINUTE, review: MINUTE, ties: MINUTE, lines: MINUTE };

/**
 * The golden books as the development server built them, each built and then rebuilt: the words in each story section, the passages and `lines` units the `text` step cut,
 * the cost of each build in dollars, and the minutes the rebuild took when it had the connection to
 * itself. Threshing Day's shared the connection with Closer to Home's and met 24 provider errors,
 * so the time check does not use it.
 */
const MEASURED = {
  'Harry Potter 1': {
    sections: [19_464, 20_661, 38_318],
    passages: 49,
    linesUnits: 16,
    costs: [0.1894, 0.1955],
    rebuildMinutes: 49,
  },
  'Threshing Day': {
    sections: [1_143, 4_103, 3_645, 6_470, 2_283, 3_938, 4_016, 4_394, 2_842, 4_601, 3_609, 2_670, 5_001, 1_399],
    passages: 37,
    linesUnits: 14,
    costs: [0.1247, 0.1217],
    rebuildMinutes: 54,
  },
  'Closer to Home': {
    sections: [7_286, 8_273, 6_470, 5_532, 8_047, 6_525, 7_428, 7_915, 5_274, 7_371, 6_142, 5_621, 7_630, 6_609, 9_828, 5_799, 6_007, 4_584],
    passages: 80,
    linesUnits: 21,
    costs: [0.2499, 0.257],
    rebuildMinutes: 70,
  },
};

const books = Object.entries(MEASURED).map(([title, book]) => ({ title, ...book, sections: book.sections.map((words) => ({ words })) }));

describe('estimateStoryGuide calibration', () => {
  it.each(books)('counts the passages and lines units the text step cut for $title', ({ sections, passages, linesUnits }) => {
    expect(Math.abs(estimatedPassages(sections) - passages)).toBeLessThanOrEqual(1);
    expect(estimatedLinesUnits(sections)).toBe(linesUnits);
  });

  it.each(books)('lands within 20% of the cost of both builds of $title', ({ sections, costs }) => {
    const { cost } = estimateStoryGuide({ sections, steps: ALL_STEPS, prices: PRICES, rates: RATES });
    for (const measured of costs) expect(Math.abs(cost! - measured) / measured).toBeLessThan(0.2);
  });

  it('orders the time of the rebuilds as they took when every step is as fast', () => {
    const minutes = (title: string) => {
      const book = books.find((candidate) => candidate.title === title)!;
      return estimateStoryGuide({ sections: book.sections, steps: ALL_STEPS, prices: PRICES, rates: RATES }).minutes!;
    };
    const measured = MEASURED['Closer to Home'].rebuildMinutes / MEASURED['Harry Potter 1'].rebuildMinutes;
    expect(Math.abs(minutes('Closer to Home') / minutes('Harry Potter 1') - measured) / measured).toBeLessThan(0.15);
  });

  it('counts the passages of the public-domain book', async () => {
    const { book, text } = await publicDomainText();
    expect(Math.abs(estimatedPassages(storySections(book)) - text.passages.length)).toBeLessThanOrEqual(2);
  });
});

describe('estimateStoryGuide', () => {
  const sections = books[1].sections;
  const passages = estimatedPassages(sections);

  it('times only the model steps, and only the steps that run', () => {
    expect(Object.keys(STORY_GUIDE_STEP_COSTS).sort()).toEqual([...STORY_GUIDE_TIMED_STEPS].sort());
    const minutes = (steps: string[]) => estimateStoryGuide({ sections, steps, prices: PRICES, rates: RATES }).minutes;
    expect(minutes(['review'])).toBe(1);
    expect(minutes(['text', 'merge'])).toBe(0);
    expect(minutes(ALL_STEPS)).toBeGreaterThan(minutes(['names', 'review'])!);
  });

  it('runs passages side by side up to the engine limit, and chains the lines units', () => {
    const names = estimateStoryGuide({ sections, steps: ['names'], prices: PRICES, rates: RATES }).minutes;
    expect(passages).toBeGreaterThan(AI_JOBS_UNIT_CONCURRENCY);
    expect(names).toBe(Math.ceil(passages / AI_JOBS_UNIT_CONCURRENCY));
    const short = estimateStoryGuide({ sections: [{ words: 100 }], steps: ['names'], prices: PRICES, rates: RATES }).minutes;
    expect(short).toBe(1);
    const lines = estimateStoryGuide({ sections, steps: ['lines'], prices: PRICES, rates: RATES });
    expect(lines.minutes).toBe(estimatedLinesUnits(sections));
    const more = estimateStoryGuide({ sections: [...sections, { words: 3_000 }], steps: ['lines'], prices: PRICES, rates: RATES });
    expect(more.minutes).toBe(lines.minutes! + 1);
    expect(more.cost!).toBeGreaterThan(lines.cost!);
    const summaries = estimateStoryGuide({ sections, steps: ['summaries'], prices: PRICES, rates: { summaries: MINUTE } });
    expect(summaries.minutes).toBe(estimatedLinesUnits(sections));
  });

  it('cuts Spanish into more passages and more tokens than English of the same word count', () => {
    const english = estimateStoryGuide({ sections, steps: ALL_STEPS, prices: PRICES, rates: RATES });
    expect(estimateStoryGuide({ sections, language: 'en', steps: ALL_STEPS, prices: PRICES, rates: RATES })).toEqual(english);
    expect(estimateStoryGuide({ sections, language: 'pt', steps: ALL_STEPS, prices: PRICES, rates: RATES })).toEqual(english);
    const spanish = estimateStoryGuide({ sections, language: 'es', steps: ALL_STEPS, prices: PRICES, rates: RATES });
    expect(estimatedPassages(sections, 'es')).toBeGreaterThan(passages);
    expect(spanish.cost!).toBeGreaterThan(english.cost!);
    expect(spanish.words).toBe(english.words);
  });

  it('leaves the time unknown when a step that runs has no learned speed, and still prices it', () => {
    const unknown = estimateStoryGuide({ sections, steps: ALL_STEPS, prices: PRICES, rates: { ...RATES, ties: null } });
    expect(unknown.minutes).toBeNull();
    expect(unknown.cost).toBeGreaterThan(0);
    expect(estimateStoryGuide({ sections, steps: ALL_STEPS, prices: PRICES, rates: {} }).minutes).toBeNull();
    // A step that reuses every unit needs no speed.
    expect(estimateStoryGuide({ sections, steps: ['names'], prices: PRICES, rates: { names: MINUTE } }).minutes).not.toBeNull();
  });

  it('prices only the steps that run, and leaves cost null for a slot without prices', () => {
    const full = estimateStoryGuide({ sections, steps: ALL_STEPS, prices: PRICES, rates: RATES });
    const review = estimateStoryGuide({ sections, steps: ['review'], prices: PRICES, rates: RATES });
    expect(review.cost!).toBeLessThan(full.cost!);
    expect(estimateStoryGuide({ sections, steps: ['names', 'review'], prices: { fast: PRICES.fast, careful: null }, rates: RATES }).cost).toBeNull();
    expect(estimateStoryGuide({ sections, steps: ['text', 'merge'], prices: PRICES, rates: {} })).toEqual({
      words: sections.reduce((total, section) => total + section.words, 0),
      minutes: 0,
      cost: 0,
    });
  });
});

describe('storyGuideMinutesLeft', () => {
  const sections = books[1].sections;
  const passages = estimatedPassages(sections);
  const linesUnits = estimatedLinesUnits(sections);
  const left = (input: Partial<Parameters<typeof storyGuideMinutesLeft>[0]>) =>
    storyGuideMinutesLeft({ sections, order: ALL_STEPS, steps: ALL_STEPS, rates: RATES, phase: null, done: 0, total: 0, ...input });

  it('counts what the current step has left, then every later step in full', () => {
    const whole = Math.ceil(passages / AI_JOBS_UNIT_CONCURRENCY);
    expect(left({ phase: 'lines', done: linesUnits - 3, total: linesUnits })).toBe(3);
    expect(left({ phase: 'ties', done: passages, total: passages })).toBe(linesUnits);
    expect(left({ phase: 'review', done: 0, total: 1 })).toBe(1 + whole + linesUnits);
    // Progress moves the answer: halfway through the names, half their time is left.
    const start = left({ phase: 'names', done: 0, total: 240 })!;
    const half = left({ phase: 'names', done: 120, total: 240 })!;
    expect(start - half).toBe(10);
  });

  it('counts everything before the first step, and skips later steps that reuse their units', () => {
    expect(left({ phase: null })).toBe(left({ phase: 'text', done: 0, total: 1 }));
    expect(left({ phase: 'review', done: 1, total: 1, steps: ['review'] })).toBe(1);
  });

  it('is unknown while a step still to run has no learned speed, whatever came before', () => {
    expect(left({ phase: 'names', done: 0, total: 10, rates: { ...RATES, lines: null } })).toBeNull();
    expect(left({ phase: 'lines', done: 0, total: 2, rates: { lines: MINUTE } })).toBe(2);
  });
});
