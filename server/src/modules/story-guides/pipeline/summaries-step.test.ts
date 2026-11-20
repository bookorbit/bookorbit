import { AiUnitSkipped } from '../../ai-jobs/ai-feature';
import { laterNames, linesUnits } from './lines-step';
import { mergeNames } from './merge-step';
import { fakeStepContext, syntheticNames, syntheticText } from './step-context.testing';
import type { StorySummaryResult } from './story-guide.types';
import {
  SUMMARIES_REWRITE_SYSTEM,
  SUMMARIES_SCHEMA,
  SUMMARIES_SYSTEM,
  readSummaryAnswer,
  summariesAiStep,
  summariesRequest,
  summaryProblem,
  writeSummary,
} from './summaries-step';

/** The cabman is Jeff until chapter 3 shows he is Jefferson Hope. */
function cabman() {
  const text = syntheticText([
    ['Jeff drove the cab. Holmes watched Jeff.'],
    ['Jefferson Hope sat in the cell. Mr. Holmes smiled on Baker Street.'],
    ['Jeff was Jefferson Hope, he told Holmes.'],
  ]);
  const names = syntheticNames(text, {
    c1p1: [['Jeff'], ['Holmes']],
    c2p1: [['Jefferson Hope'], ['Mr. Holmes', ['Holmes']], ['Baker Street', [], 'place']],
    c3p1: [['Jefferson Hope', ['Jeff']], ['Holmes']],
  });
  return { text, merge: mergeNames(text.passages, names) };
}

/** Four lines units: chapter 1, chapter 2 in two parts, chapter 3. */
function parted() {
  const text = syntheticText([['Ann rode out.'], ['Ann met Ben.', 'Ben lied to Ann.'], ['Ann left.']], { 2: [1, 1] });
  return { text, merge: mergeNames(text.passages, new Map()) };
}

const reply = (summary: string) => JSON.stringify({ summary });

const done = (text: string | null, chapter = 1, part: number | null = null): StorySummaryResult => ({
  through: { chapter, part },
  text,
  dropped: null,
  rewritten: false,
});

describe('summaries prompt', () => {
  it('sends the chapter, after the summary before it when there is one, with the schema', () => {
    expect(summariesRequest('Jeff drove the cab.', null)).toEqual({
      system: SUMMARIES_SYSTEM,
      user: '<chapter>\nJeff drove the cab.\n</chapter>',
      schema: SUMMARIES_SCHEMA,
      maxOutputTokens: 6000,
      effort: 'medium',
    });
    expect(summariesRequest('Holmes smiled.', 'Jeff drove a cab.').user).toBe(
      '<before>\nJeff drove a cab.\n</before>\n\n<chapter>\nHolmes smiled.\n</chapter>',
    );
  });

  it('asks for a few sentences on this stretch alone, from its text, in its language', () => {
    expect(SUMMARIES_SYSTEM).toContain('two to four plain sentences, at most 90 words');
    expect(SUMMARIES_SYSTEM).toContain('Never use what you know of the book');
    expect(SUMMARIES_SYSTEM).toContain('never say what will happen later');
    expect(SUMMARIES_SYSTEM).toContain('Write in the language of the chapter.');
  });

  it('reads the summary, dropping a stray closing brace, and refuses an answer without one', () => {
    expect(readSummaryAnswer({ summary: ' Jeff drives a cab. }' })).toBe('Jeff drives a cab.');
    expect(readSummaryAnswer({ summary: '' })).toBe('');
    expect(readSummaryAnswer({ summaries: 'Jeff drives a cab.' })).toBeNull();
    expect(readSummaryAnswer({ summary: ['Jeff drives a cab.'] })).toBeNull();
  });
});

describe('summary checks', () => {
  const none = { later: [], visible: [] };

  it('fails a summary naming an entity first anchored after its unit, and passes it from that unit on', () => {
    const { text, merge } = cabman();
    expect(summaryProblem('Jefferson Hope drives a cab.', laterNames(0, text, merge))).toEqual({
      reason: 'names-later-entity',
      detail: 'names Jefferson Hope, not introduced yet',
    });
    expect(summaryProblem('Jeff drives a cab while Holmes watches him.', laterNames(0, text, merge))).toBeNull();
    expect(summaryProblem('Jeff tells Holmes he is Jefferson Hope.', laterNames(2, text, merge))).toBeNull();
  });

  it('fails a summary over 120 words', () => {
    expect(summaryProblem(Array.from({ length: 121 }, () => 'word').join(' '), none)).toEqual({
      reason: 'too-long',
      detail: 'is longer than 90 words',
    });
    expect(summaryProblem(Array.from({ length: 120 }, () => 'word').join(' '), none)).toBeNull();
  });
});

describe('writeSummary', () => {
  const { text, merge } = cabman();
  const through = { chapter: 1, part: null };
  const later = laterNames(0, text, merge);
  const chapter = text.passages[0].text;

  it('keeps a summary that passes, from one request', async () => {
    const ctx = fakeStepContext({}, () => reply('Jeff drives a cab while Holmes watches him.'));
    expect(await writeSummary(ctx, through, chapter, null, later)).toEqual({
      through,
      text: 'Jeff drives a cab while Holmes watches him.',
      dropped: null,
      rewritten: false,
    });
    expect(ctx.requests).toEqual([summariesRequest(chapter, null)]);
  });

  it('gives a summary naming someone not introduced yet one rewrite, without the chapter', async () => {
    const ctx = fakeStepContext({}, (_, index) => reply(index === 0 ? 'Jefferson Hope drives a cab.' : 'Jeff drives a cab.'));
    expect(await writeSummary(ctx, through, chapter, null, later)).toEqual({
      through,
      text: 'Jeff drives a cab.',
      dropped: null,
      rewritten: true,
    });
    expect(ctx.requests[1]).toEqual({
      system: SUMMARIES_REWRITE_SYSTEM,
      user: '"Jefferson Hope drives a cab." (names Jefferson Hope, not introduced yet)',
      schema: SUMMARIES_SCHEMA,
      maxOutputTokens: 6000,
      effort: 'medium',
    });
  });

  it('leaves the summary out when the rewrite fails too, and writes none of its own', async () => {
    const ctx = fakeStepContext({}, () => reply('Jefferson Hope drives a cab.'));
    expect(await writeSummary(ctx, through, chapter, null, later)).toEqual({
      through,
      text: null,
      dropped: { text: 'Jefferson Hope drives a cab.', reason: 'names-later-entity' },
      rewritten: true,
    });
    expect(ctx.requests).toHaveLength(2);
  });

  it('keeps the first summary as the dropped one when the rewrite comes back unusable', async () => {
    const ctx = fakeStepContext({}, (_, index) => (index === 0 ? reply('Jefferson Hope drives a cab.') : 'no JSON here'));
    expect((await writeSummary(ctx, through, chapter, null, later)).dropped).toEqual({
      text: 'Jefferson Hope drives a cab.',
      reason: 'names-later-entity',
    });
  });

  it('has no summary for a stretch the model finds no story in, and asks nothing for an empty one', async () => {
    for (const answer of ['', 'None.']) {
      const result = await writeSummary(
        fakeStepContext({}, () => reply(answer)),
        through,
        chapter,
        null,
        later,
      );
      expect(result).toEqual({ through, text: null, dropped: null, rewritten: false });
    }
    const ctx = fakeStepContext({}, () => reply('Anything.'));
    expect(await writeSummary(ctx, through, '  \n', null, later)).toEqual({ through, text: null, dropped: null, rewritten: false });
    expect(ctx.requests).toHaveLength(0);
  });

  it('leaves the unit out when the answer is not JSON twice', async () => {
    const ctx = fakeStepContext({}, () => 'Jeff drives a cab.');
    await expect(writeSummary(ctx, through, chapter, null, later)).rejects.toMatchObject({ reason: 'invalid-json' });
    expect(ctx.requests).toHaveLength(2);
  });

  it('leaves the unit out when the provider refuses or filters the request or its rewrite', async () => {
    await expect(
      writeSummary(
        fakeStepContext({}, () => new AiUnitSkipped('refused')),
        through,
        chapter,
        null,
        later,
      ),
    ).rejects.toMatchObject({
      reason: 'refused',
    });
    const rewrite = fakeStepContext({}, (_, index) => (index === 0 ? reply('Jefferson Hope drives a cab.') : new AiUnitSkipped('filtered')));
    await expect(writeSummary(rewrite, through, chapter, null, later)).rejects.toMatchObject({ reason: 'filtered' });
  });
});

describe('summariesAiStep', () => {
  const step = summariesAiStep();

  it('chains the lines units in order on the fast slot, reading the merge only for names', () => {
    expect(step).toMatchObject({ id: 'summaries', version: 1, slot: 'fast', sequential: true, dependsOn: ['text', 'merge'] });
  });

  it('has exactly the units of the lines step', () => {
    const { text, merge } = parted();
    const units = step.units(fakeStepContext({ text: { book: text }, merge: { book: merge } }));
    expect(units).toEqual(linesUnits(text).units.map((unit) => ({ id: unit.id })));
    expect(units.map((unit) => unit.id)).toEqual(['c1', 'c2p1', 'c2p2', 'c3']);
  });

  it("sends each unit its own text with the newest summary before it, and stamps it with the unit's end", async () => {
    const { text, merge } = parted();
    const run = async (id: string, summaries: Record<string, StorySummaryResult>) => {
      const ctx = fakeStepContext({ text: { book: text }, merge: { book: merge }, summaries }, () => reply('Ann and Ben talk.'));
      const result = (await step.run(ctx, { id })) as StorySummaryResult;
      return { result, user: ctx.requests[0].user };
    };

    expect((await run('c1', {})).user).toBe('<chapter>\nAnn rode out.\n</chapter>');
    const second = await run('c2p2', { c1: done('Ann rides out.'), c2p1: done('Ann meets Ben.', 2, 1) });
    expect(second.user).toBe('<before>\nAnn meets Ben.\n</before>\n\n<chapter>\nBen lied to Ann.\n</chapter>');
    expect(second.result).toEqual({ through: { chapter: 2, part: 2 }, text: 'Ann and Ben talk.', dropped: null, rewritten: false });
    // A unit left out, or one with no summary, passes on the one before it.
    expect((await run('c2p2', { c1: done('Ann rides out.') })).user).toContain('<before>\nAnn rides out.\n</before>');
    expect((await run('c3', { c1: done('Ann rides out.'), c2p1: done(null, 2, 1) })).user).toContain('<before>\nAnn rides out.\n</before>');
  });

  it('runs a unit again when the summary before it changes, and only then', () => {
    const { text, merge } = parted();
    const print = (before: string) =>
      step.fingerprint(fakeStepContext({ text: { book: text }, merge: { book: merge }, summaries: { c1: done(before) } }), { id: 'c2p1' });
    expect(print('Ann rides out.')).toBe(print('Ann rides out.'));
    expect(print('Ann rides out.')).not.toBe(print('Ann rides away.'));
  });

  it("checks names against what a reader at the unit's end has met", async () => {
    const { text, merge } = cabman();
    const ctx = () => fakeStepContext({ text: { book: text }, merge: { book: merge } }, () => reply('Jefferson Hope tells Holmes the truth.'));
    expect(await step.run(ctx(), { id: 'c1' })).toMatchObject({ text: null, dropped: { reason: 'names-later-entity' } });
    expect(await step.run(ctx(), { id: 'c3' })).toMatchObject({ text: 'Jefferson Hope tells Holmes the truth.', dropped: null });
  });
});
