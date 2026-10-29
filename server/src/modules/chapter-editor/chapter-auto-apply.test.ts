import type { ChapterLookupNode, ChapterLookupResult } from '@bookorbit/types';

import { flattenLookupTree, planAutoApply } from './chapter-auto-apply';

function node(title: string, startMs: number, children: ChapterLookupNode[] = []): ChapterLookupNode {
  return { title, startMs, lengthMs: null, children };
}

// A real release: Audible's runtime counts a 4.04 s "This is Audible" lead-in and a 5.06 s sign-off.
const RUNTIME_MS = 37_206_520;
const INTRO_MS = 4_040;
const OUTRO_MS = 5_061;
const WITHOUT_BRANDING_MS = RUNTIME_MS - INTRO_MS - OUTRO_MS;

const CHAPTERS = [
  node('Opening Credits', 0),
  node('Chapter 1', 21_610),
  node('Chapter 2', 2_480_310),
  node('Chapter 3', 5_102_844),
  node('Chapter 4', 9_870_115),
  node('End Credits', RUNTIME_MS - 40_000),
];

function lookup(overrides: Partial<ChapterLookupResult> = {}): ChapterLookupResult {
  return {
    provider: 'audible',
    asin: 'B0TESTASIN',
    region: 'us',
    chapters: CHAPTERS,
    runtimeMs: RUNTIME_MS,
    brandIntroMs: INTRO_MS,
    brandOutroMs: OUTRO_MS,
    isAccurate: true,
    ...overrides,
  };
}

/** `count` chapters spread evenly over `totalMs`, the first at 0. */
function evenChapters(count: number, totalMs: number): ChapterLookupNode[] {
  return Array.from({ length: count }, (_, index) => node(`Chapter ${index + 1}`, Math.floor((index * totalMs) / count)));
}

describe('flattenLookupTree', () => {
  it('lists parts and their chapters in reading order, keeping each part heading as a chapter of its own', () => {
    const tree = [
      node('Opening Credits', 0),
      node('Part One', 18_000, [node('Chapter 1', 19_200), node('Chapter 2', 1_200_000, [node('Interlude', 1_500_000)])]),
      node('Part Two', 2_400_000, [node('Chapter 3', 2_401_500)]),
    ];

    expect(flattenLookupTree(tree)).toEqual([
      { title: 'Opening Credits', startMs: 0 },
      { title: 'Part One', startMs: 18_000 },
      { title: 'Chapter 1', startMs: 19_200 },
      { title: 'Chapter 2', startMs: 1_200_000 },
      { title: 'Interlude', startMs: 1_500_000 },
      { title: 'Part Two', startMs: 2_400_000 },
      { title: 'Chapter 3', startMs: 2_401_500 },
    ]);
  });

  it('returns nothing for an empty tree', () => {
    expect(flattenLookupTree([])).toEqual([]);
  });
});

describe('planAutoApply', () => {
  it('leaves combined part and leaf titles that exceed the editor limit for review', () => {
    expect(planAutoApply(lookup({ chapters: [node('P'.repeat(300), 0, [node('C'.repeat(300), 0)]), node('Second', 60_000)] }), RUNTIME_MS)).toEqual({
      kind: 'review',
      reason: 'implausible',
    });
  });

  it.each([
    { name: 'unknown', totalDurationMs: null },
    { name: 'zero', totalDurationMs: 0 },
    { name: 'negative', totalDurationMs: -1 },
  ])('leaves a book whose length is $name for review', ({ totalDurationMs }) => {
    expect(planAutoApply(lookup(), totalDurationMs)).toEqual({ kind: 'review', reason: 'unknown_length' });
  });

  it.each([
    { name: 'inexact', isAccurate: false },
    { name: 'unrated', isAccurate: null },
  ])('leaves timings Audible calls $name for review, even when the runtime matches', ({ isAccurate }) => {
    expect(planAutoApply(lookup({ isAccurate }), WITHOUT_BRANDING_MS)).toEqual({ kind: 'review', reason: 'not_exact' });
    expect(planAutoApply(lookup({ isAccurate }), RUNTIME_MS)).toEqual({ kind: 'review', reason: 'not_exact' });
  });

  it('leaves a lookup without a runtime for review, since nothing can be compared', () => {
    expect(planAutoApply(lookup({ runtimeMs: null }), WITHOUT_BRANDING_MS)).toEqual({ kind: 'review', reason: 'runtime_mismatch' });
  });

  it('leaves a book 7.4 s shorter than the stripped runtime for review', () => {
    // 37,190,000 against 37,197,419 without branding (7.4 s) and 37,206,520 with it (16.5 s).
    expect(planAutoApply(lookup(), 37_190_000)).toEqual({ kind: 'review', reason: 'runtime_mismatch' });
  });

  it('applies to a file without branding, pulling every chapter earlier by the lead-in and the first one to 0', () => {
    const plan = planAutoApply(lookup(), WITHOUT_BRANDING_MS);

    expect(plan).toEqual({
      kind: 'apply',
      offsetMs: -INTRO_MS,
      chapters: [
        { title: 'Opening Credits', startMs: 0 },
        { title: 'Chapter 1', startMs: 17_570 },
        { title: 'Chapter 2', startMs: 2_476_270 },
        { title: 'Chapter 3', startMs: 5_098_804 },
        { title: 'Chapter 4', startMs: 9_866_075 },
        { title: 'End Credits', startMs: RUNTIME_MS - 40_000 - INTRO_MS },
      ],
    });
  });

  it('applies to a file that kept its branding, with the timings as Audible gives them', () => {
    const plan = planAutoApply(lookup(), RUNTIME_MS - 1_500);

    expect(plan).toEqual({
      kind: 'apply',
      offsetMs: 0,
      chapters: CHAPTERS.map((chapter) => ({ title: chapter.title, startMs: chapter.startMs })),
    });
  });

  it('accepts a difference of exactly 2 s either side, and nothing more', () => {
    expect(planAutoApply(lookup(), WITHOUT_BRANDING_MS + 2_000)).toMatchObject({ kind: 'apply', offsetMs: -INTRO_MS });
    expect(planAutoApply(lookup(), WITHOUT_BRANDING_MS - 2_000)).toMatchObject({ kind: 'apply', offsetMs: -INTRO_MS });
    expect(planAutoApply(lookup(), RUNTIME_MS + 2_000)).toMatchObject({ kind: 'apply', offsetMs: 0 });
    expect(planAutoApply(lookup(), WITHOUT_BRANDING_MS - 2_001)).toEqual({ kind: 'review', reason: 'runtime_mismatch' });
    expect(planAutoApply(lookup(), RUNTIME_MS + 2_001)).toEqual({ kind: 'review', reason: 'runtime_mismatch' });
  });

  it('prefers the stripped reading when the branding is short enough for both to match', () => {
    const plan = planAutoApply(lookup({ brandIntroMs: 800, brandOutroMs: 700 }), RUNTIME_MS - 1_000);

    expect(plan).toMatchObject({ kind: 'apply', offsetMs: -800 });
  });

  it('starts the first chapter at 0 even when Audible places it later', () => {
    const chapters = [node('Chapter 1', 12_000), ...CHAPTERS.slice(2)];

    const plan = planAutoApply(lookup({ chapters, brandIntroMs: 0, brandOutroMs: 0 }), RUNTIME_MS);

    expect(plan.kind).toBe('apply');
    expect(plan.kind === 'apply' && plan.chapters.slice(0, 2)).toEqual([
      { title: 'Chapter 1', startMs: 0 },
      { title: 'Chapter 2', startMs: 2_480_310 },
    ]);
  });

  it('applies a flattened tree, part headings kept, trimmed and in order', () => {
    const chapters = [
      node('Opening Credits', 0),
      node(' Part One ', 30_000, [node('Chapter 1', 31_500), node('Chapter 2', 4_000_000)]),
      node('Part Two', 18_000_000, [node('Chapter 3', 18_001_200)]),
    ];

    const plan = planAutoApply(lookup({ chapters }), RUNTIME_MS);

    expect(plan).toEqual({
      kind: 'apply',
      offsetMs: 0,
      chapters: [
        { title: 'Opening Credits', startMs: 0 },
        { title: 'Part One', startMs: 30_000 },
        { title: 'Chapter 1', startMs: 31_500 },
        { title: 'Chapter 2', startMs: 4_000_000 },
        { title: 'Part Two', startMs: 18_000_000 },
        { title: 'Chapter 3', startMs: 18_001_200 },
      ],
    });
  });

  it('drops chapters the shift moves before 0 onto one start, keeping the first title', () => {
    const chapters = [node('Opening Credits', 0), node('Prologue', 3_000), node('Chapter 1', 600_000)];

    const plan = planAutoApply(lookup({ chapters }), WITHOUT_BRANDING_MS);

    expect(plan).toMatchObject({
      kind: 'apply',
      chapters: [
        { title: 'Opening Credits', startMs: 0 },
        { title: 'Chapter 1', startMs: 600_000 - INTRO_MS },
      ],
    });
  });

  it('drops chapters starting at or after the end of the book', () => {
    // Shifted by the lead-in, the sign-off starts exactly where the stripped file ends.
    const chapters = [...CHAPTERS.slice(0, 5), node('End Credits', WITHOUT_BRANDING_MS + INTRO_MS)];

    const plan = planAutoApply(lookup({ chapters }), WITHOUT_BRANDING_MS);

    expect(plan).toMatchObject({ kind: 'apply' });
    expect(plan.kind === 'apply' && plan.chapters.map((chapter) => chapter.title)).toEqual([
      'Opening Credits',
      'Chapter 1',
      'Chapter 2',
      'Chapter 3',
      'Chapter 4',
    ]);
  });

  it.each([
    { name: 'a single chapter', chapters: [node('Chapter 1', 0)] },
    {
      name: 'one chapter left once those past the end are dropped',
      chapters: [node('Chapter 1', 0), node('Chapter 2', RUNTIME_MS + 10_000)],
    },
    { name: 'a blank title', chapters: [node('Chapter 1', 0), node('   ', 600_000), node('Chapter 3', 1_200_000)] },
    { name: 'a blank part heading', chapters: [node('Chapter 1', 0), node('', 600_000, [node('Chapter 2', 601_000)])] },
    { name: 'chapters averaging under 30 s', chapters: evenChapters(1_241, RUNTIME_MS) },
  ])('leaves a list with $name for review', ({ chapters }) => {
    expect(planAutoApply(lookup({ chapters }), RUNTIME_MS)).toEqual({ kind: 'review', reason: 'implausible' });
  });

  it('leaves two chapters the shift moves onto one start for review, since one chapter is left', () => {
    const chapters = [node('Opening Credits', 0), node('Chapter 1', 2_000)];

    expect(planAutoApply(lookup({ chapters }), WITHOUT_BRANDING_MS)).toEqual({ kind: 'review', reason: 'implausible' });
  });

  it('accepts chapters averaging exactly 30 s', () => {
    const totalMs = 30_000 * 40;

    const plan = planAutoApply(lookup({ chapters: evenChapters(40, totalMs), runtimeMs: totalMs, brandIntroMs: 0, brandOutroMs: 0 }), totalMs);

    expect(plan.kind).toBe('apply');
    expect(plan.kind === 'apply' && plan.chapters).toHaveLength(40);
  });

  it('reads the provider list without changing it', () => {
    const chapters = [node(' Opening Credits ', 0), node('Part One', 30_000, [node('Chapter 1', 31_500)])];
    const before = JSON.stringify(chapters);

    planAutoApply(lookup({ chapters }), WITHOUT_BRANDING_MS);

    expect(JSON.stringify(chapters)).toBe(before);
  });
});

describe('Chapter lookup regressions', () => {
  it('never auto applies a response the parser truncated', () => {
    expect(planAutoApply(lookup({ truncated: true }), RUNTIME_MS).kind).toBe('review');
  });
  it('keeps the full runtime clock when it matches more closely than stripped branding', () => {
    const plan = planAutoApply(lookup(), RUNTIME_MS);
    expect(plan.kind).toBe('apply');
    if (plan.kind === 'apply') expect(plan.chapters[1].startMs).toBe(CHAPTERS[1].startMs);
  });
  it('preserves the first child name when a part heading shares its start', () => {
    expect(flattenLookupTree([node('Part One', 0, [node('Chapter One', 0), node('Chapter Two', 60_000)])])).toEqual([
      { title: 'Part One: Chapter One', startMs: 0 },
      { title: 'Chapter Two', startMs: 60_000 },
    ]);
  });
});
