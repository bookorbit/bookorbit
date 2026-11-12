import { createHash } from 'crypto';

import { parseJsonReply } from './json-reply';
import { labReplay } from './lab-replay.testing';
import { mergeNames } from './merge-step';
import {
  REVIEW_SYSTEM,
  applyReview,
  firstSighting,
  readReviewAnswer,
  reviewAiStep,
  reviewBatches,
  reviewGroups,
  reviewLine,
  reviewRequests,
} from './review-step';
import { passageOrder } from './step-context';
import { fakeStepContext, syntheticNames, syntheticText, type SyntheticEntry } from './step-context.testing';
import type { StoryMergedEntity } from './story-guide.types';

function book(chapters: string[][], entries: Record<string, readonly SyntheticEntry[]>) {
  const text = syntheticText(chapters);
  const merge = mergeNames(text.passages, syntheticNames(text, entries));
  const id = (name: string) => merge.entities.find((entity) => entity.name === name)!.id;
  const review = (answered: unknown[]) => applyReview(reviewGroups(answered, merge, text), merge, text);
  return { text, merge, id, review };
}

/** The cabman is Jeff until chapter 3 shows he is Jefferson Hope. */
const cabman = (chapter3: string) =>
  book([['Jeff drove the cab while Holmes watched.'], ['Jefferson Hope sat in the cell.'], [chapter3]], {
    c1p1: [['Jeff'], ['Holmes']],
    c2p1: [['Jefferson Hope']],
    c3p1: chapter3.includes('Jefferson Hope') ? [['Jefferson Hope']] : [['Holmes']],
  });

describe('review prompt', () => {
  it('is the pinned prompt: a change to it bumps the step version', () => {
    expect(createHash('sha256').update(REVIEW_SYSTEM).digest('hex').slice(0, 16)).toBe('b4e3c11edea4586e');
  });

  it('asks to join the marked lines of one narrator under several names', () => {
    expect(REVIEW_SYSTEM).toContain('A line that ends with "narrator"');
    expect(REVIEW_SYSTEM).toContain('The mark alone never joins two lines.');
  });

  it('lists each entity on one line', () => {
    const entity: StoryMergedEntity = {
      id: 4,
      name: 'Sherlock Holmes',
      first: 'c1p1',
      names: ['Sherlock Holmes', 'Holmes', 'Mr. Holmes'].map((text) => ({
        key: text.toLowerCase().replace('.', ''),
        text,
        at: { passage: 'c1p1', offset: 0, text },
      })),
      kinds: [{ passage: 'c1p1', kind: 'character' }],
      what: [{ passage: 'c1p1', text: 'A detective' }],
      passages: ['c2p1', 'c1p1', 'c2p2'],
    };
    expect(
      reviewLine(
        entity,
        new Map([
          ['c1p1', 1],
          ['c2p1', 2],
          ['c2p2', 2],
        ]),
      ),
    ).toBe('4 | Sherlock Holmes | Holmes, Mr. Holmes | character | 1,2 | A detective');
  });

  it('ends the line of an entity that tells passages as "I" with "narrator", and no other', () => {
    const entity = (id: number, name: string, narrated?: number): StoryMergedEntity => ({
      id,
      name,
      first: 'c1p1',
      names: [{ key: name.toLowerCase(), text: name, at: { passage: 'c1p1', offset: 0, text: name } }],
      kinds: [{ passage: 'c1p1', kind: 'character' }],
      what: [{ passage: 'c1p1', text: 'A schoolgirl' }],
      passages: ['c1p1'],
      ...(narrated ? { narrated } : {}),
    });
    const chapters = new Map([['c1p1', 1]]);
    expect(reviewLine(entity(0, 'Lenuccia', 3), chapters)).toBe('0 | Lenuccia |  | character | 1 | A schoolgirl | narrator');
    expect(reviewLine(entity(1, 'Lila'), chapters)).toBe('1 | Lila |  | character | 1 | A schoolgirl');
  });

  it('asks at medium effort with the whole cast when it fits', () => {
    const { text, merge } = cabman('Holmes laughed.');
    const requests = reviewRequests(merge, text);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ system: REVIEW_SYSTEM, maxOutputTokens: 16000, effort: 'medium' });
    expect(requests[0].user.split('\n')).toHaveLength(merge.entities.length);
  });
});

describe('reviewBatches', () => {
  const entity = (id: number, name: string): StoryMergedEntity => ({
    id,
    name,
    first: 'c1p1',
    names: [{ key: name.toLowerCase(), text: name, at: { passage: 'c1p1', offset: 0, text: name } }],
    kinds: [],
    what: [],
    passages: [],
  });

  it('keeps entities that share a name word together, and cuts a large word with an overlap', () => {
    const entities = [
      entity(0, 'Anna Grey'),
      entity(1, 'Tom Grey'),
      entity(2, 'Ben Smith'),
      entity(3, 'Cara Smith'),
      entity(4, 'Dan Smith'),
      entity(5, 'Eve Smith'),
      entity(6, 'Fay Smith'),
      entity(7, 'Gus Smith'),
      entity(8, 'Lone'),
    ];
    const lines = entities.map(() => 'x'.repeat(9));
    expect(reviewBatches(entities, lines, 1000)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8]]);
    const batches = reviewBatches(entities, lines, 40);
    expect(batches).toEqual([
      [2, 3, 4, 5],
      [5, 6, 7],
      [0, 1, 8],
    ]);
    expect(batches.every((batch) => batch.length * 10 <= 40)).toBe(true);
  });
});

describe('reviewGroups', () => {
  it('keeps real ids, needs two, and never dates a join before the later member appears', () => {
    const { text, merge, id } = cabman('Holmes laughed.');
    const groups = reviewGroups(
      [
        { ids: [id('Jeff'), id('Jefferson Hope'), 99, -1, 'x', id('Jeff')], from: 1 },
        { ids: [id('Jeff'), id('Jefferson Hope')], from: '3' },
        { ids: [id('Jeff'), id('Jefferson Hope')] },
        { ids: [id('Holmes')] },
        'junk',
      ],
      merge,
      text,
    );
    expect(groups).toEqual([
      { ids: [id('Jeff'), id('Jefferson Hope')], from: 2, modelFrom: 1 },
      { ids: [id('Jeff'), id('Jefferson Hope')], from: 3, modelFrom: 3 },
      { ids: [id('Jeff'), id('Jefferson Hope')], from: 2, modelFrom: null },
    ]);
  });
});

describe('applyReview', () => {
  it('joins an ordinary group at the later member’s first appearance', () => {
    const { id, review, merge, text } = cabman('Holmes laughed.');
    const result = review([{ ids: [id('Jefferson Hope'), id('Jeff')], from: 1 }]);
    expect(result.joins).toEqual([
      { member: id('Jefferson Hope'), into: id('Jeff'), chapter: 2, at: { passage: 'c2p1', offset: 0, text: 'Jefferson Hope' }, reveal: false },
    ]);
    expect(result.joins[0].at).toEqual(firstSighting(merge.entities[id('Jefferson Hope')], passageOrder(text)));
    expect(result.cast).toHaveLength(2);
    expect(result.cast[0]).toEqual({ id: id('Jeff'), name: 'Jeff', kind: 'character', members: [id('Jeff'), id('Jefferson Hope')] });
  });

  it('joins a reveal at a short quote naming both, from the chapter given', () => {
    const { id, review } = cabman('Holmes said the cabman Jeff was Jefferson Hope all along.');
    const result = review([{ ids: [id('Jeff'), id('Jefferson Hope')], from: 3 }]);
    expect(result.joins).toEqual([
      {
        member: id('Jeff'),
        into: id('Jefferson Hope'),
        chapter: 3,
        at: { passage: 'c3p1', offset: 23, text: 'Jeff was Jefferson Hope' },
        reveal: true,
      },
    ]);
    expect(result.blocked).toEqual([]);
  });

  it('keeps a reveal without a quote as two entries', () => {
    const { id, review } = cabman('Holmes laughed.');
    const result = review([{ ids: [id('Jeff'), id('Jefferson Hope')], from: 3 }]);
    expect(result.joins).toEqual([]);
    expect(result.cast).toHaveLength(3);
    expect(result.blocked).toEqual([
      { id: id('Jeff'), reason: 'reveal-without-quote' },
      { id: id('Jefferson Hope'), reason: 'reveal-without-quote' },
    ]);
  });

  it('keeps a reveal whose only quote is too long as two entries', () => {
    const { id, review } = cabman(`Jeff ${'and then the long road went on '.repeat(3)}to Jefferson Hope.`);
    expect(review([{ ids: [id('Jeff'), id('Jefferson Hope')], from: 3 }]).joins).toEqual([]);
  });

  it('keeps out honorifics, a surname two people share, other kinds and a person with a conflicting name', () => {
    const { id, review } = book(
      [
        ['Enoch Drebber and Joseph Drebber met Sir and Holmes on Baker Street.'],
        ['Drebber sat. Sherlock Holmes of Baker Street laughed. Harry Potter and James Potter waved.'],
      ],
      {
        c1p1: [['Enoch Drebber'], ['Joseph Drebber'], ['Sir'], ['Holmes'], ['Baker Street', [], 'place']],
        c2p1: [['Drebber'], ['Sherlock Holmes'], ['Baker Street', [], 'place'], ['Harry Potter'], ['James Potter']],
      },
    );
    const result = review([
      { ids: [id('Holmes'), id('Sir')] },
      { ids: [id('Enoch Drebber'), id('Drebber')] },
      { ids: [id('Holmes'), id('Sherlock Holmes'), id('Baker Street')] },
      { ids: [id('Harry Potter'), id('James Potter')] },
    ]);
    expect(result.blocked).toEqual([
      { id: id('Sir'), reason: 'honorific' },
      { id: id('Drebber'), reason: 'shared-surname' },
      { id: id('Baker Street'), reason: 'other-kind' },
      { id: id('James Potter'), reason: 'another-person' },
    ]);
    expect(result.joins.map((join) => [join.member, join.into])).toEqual([[id('Sherlock Holmes'), id('Holmes')]]);
  });

  it('names a cast entity after the member with the most passages, which the others join', () => {
    const { id, review } = book([['Jeff ran.'], ['Hope ran.'], ['Hope sat.']], {
      c1p1: [['Jeff']],
      c2p1: [['Hope']],
      c3p1: [['Hope']],
    });
    const result = review([{ ids: [id('Jeff'), id('Hope')] }]);
    expect(result.cast).toEqual([{ id: id('Hope'), name: 'Hope', kind: 'character', members: [id('Hope'), id('Jeff')] }]);
    expect(result.joins).toMatchObject([{ member: id('Jeff'), into: id('Hope'), chapter: 2, reveal: false }]);
  });
});

describe('reviewAiStep', () => {
  it('reviews the cast on the careful slot and applies the answer', async () => {
    const { text, merge, id } = cabman('Holmes laughed.');
    const ctx = fakeStepContext({ text: { book: text }, merge: { book: merge } }, () =>
      JSON.stringify({ groups: [{ ids: [id('Jeff'), id('Jefferson Hope')], from: 2 }] }),
    );
    const step = reviewAiStep();
    expect(step).toMatchObject({ id: 'review', version: 2, slot: 'careful', dependsOn: ['text', 'merge'] });
    expect(step.units(ctx)).toEqual([{ id: 'cast' }]);
    expect(step.fingerprint(ctx, { id: 'cast' })).toMatch(/^[0-9a-f]{64}$/);
    const result = await step.run(ctx, { id: 'cast' });
    expect(result).toMatchObject({ joins: [{ member: id('Jefferson Hope'), chapter: 2 }] });
    expect(ctx.requests).toHaveLength(1);
    expect(ctx.requests[0].effort).toBe('medium');
  });

  it('leaves the cast out after two answers with no groups', async () => {
    const { text, merge } = cabman('Holmes laughed.');
    const ctx = fakeStepContext({ text: { book: text }, merge: { book: merge } }, () => '{"answer": "none"}');
    await expect(reviewAiStep().run(ctx, { id: 'cast' })).rejects.toMatchObject({ reason: 'invalid-json' });
  });
});

describe('the saved public-domain review', () => {
  it('builds the lab cast from the saved reply, every join dated', async () => {
    const replay = await labReplay();
    const { merge, review, text } = replay;
    expect(readReviewAnswer(parseJsonReply(replay.lab.review.raw) ?? {})).toHaveLength(replay.lab.review.groups.length);
    const sets = (groups: number[][]) => groups.map((ids) => [...ids].sort((a, b) => a - b).join(',')).sort();
    const labFinal = replay.lab.final as { ids: number[] }[];
    expect(review.cast).toHaveLength(251);
    expect(sets(review.cast.map((entity) => entity.members))).toEqual(sets(labFinal.map((entity) => entity.ids)));
    expect(review.groups.map((group) => [group.ids, group.from])).toEqual(replay.lab.review.groups.map((group) => [group.ids, group.from]));

    const order = passageOrder(text);
    expect(review.joins).toHaveLength(12);
    expect(review.joins.filter((join) => join.reveal)).toHaveLength(0);
    for (const join of review.joins) {
      const sighting = firstSighting(merge.entities[join.member], order);
      const into = firstSighting(merge.entities[join.into], order);
      const later = order.get(sighting.passage)! >= order.get(into.passage)! ? sighting : into;
      expect(order.get(join.at.passage)).toBeGreaterThanOrEqual(order.get(later.passage)!);
    }
    expect(review.blocked).toEqual([
      { id: 156, reason: 'shared-surname' },
      { id: 163, reason: 'shared-surname' },
      { id: 202, reason: 'honorific' },
    ]);
  });
});
