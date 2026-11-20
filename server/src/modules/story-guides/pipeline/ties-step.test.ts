import { createHash } from 'crypto';

import { STORY_GUIDE_TIE_TYPES, storyGuideTieType } from '@bookorbit/types';

import { labReplay } from './lab-replay.testing';
import { mergeNames } from './merge-step';
import { applyReview } from './review-step';
import { passageOrder } from './step-context';
import { fakeStepContext, syntheticNames, syntheticText, type SyntheticEntry } from './step-context.testing';
import type { PassageSpan } from './story-guide.types';
import {
  TIES_SYSTEM,
  checkTies,
  findQuote,
  nameTokens,
  narratorFill,
  readTiesAnswer,
  shipTies,
  tiesAiStep,
  tiesCast,
  tiesRequest,
  type FilledNarrator,
  type PlacedTie,
} from './ties-step';

function passage(text: string, entries: readonly SyntheticEntry[], narrator?: string, fill?: FilledNarrator) {
  const book = syntheticText([[text]]);
  const names = syntheticNames(book, { c1p1: entries }, narrator ? { c1p1: narrator } : {});
  const merge = mergeNames(book.passages, names);
  const cast = tiesCast(names.get('c1p1')!, text, fill);
  return {
    cast,
    merge,
    check: (...relations: unknown[]) => checkTies(relations, book.passages[0], cast, merge.placement.c1p1),
  };
}

const tie = (a: string, type: string, b: string, quote: string) => ({ a, type, b, quote });

describe('ties prompt', () => {
  it('is the pinned prompt: a change to it bumps the step version', () => {
    expect(createHash('sha256').update(TIES_SYSTEM).digest('hex').slice(0, 16)).toBe('819f04299df7bb41');
  });

  it('keeps a family named as a whole out of family ties, and words said in anger or a vision out of every tie', () => {
    expect(TIES_SYSTEM).toContain('A family named as a whole ("the Harpers") is not a person');
    expect(TIES_SYSTEM).toContain('Strong words a character says or thinks in anger, fear, sleep or a vision');
    expect(TIES_SYSTEM).toContain('relatives stay relatives');
  });

  it('sends the passage, its narrator and its names at medium effort', () => {
    const { cast } = passage('I met Mary Morstan. My wife, I said to me, was kind.', [['Mary Morstan']], 'Mary Morstan');
    expect(tiesRequest('Text.', cast)).toEqual({
      system: TIES_SYSTEM,
      user: 'Passage:\nText.\n\nThis passage is told by Mary Morstan as "I".\n\nNames:\nMary Morstan (character)',
      maxOutputTokens: 6000,
      effort: 'medium',
    });
    expect(readTiesAnswer({ relations: [] })).toEqual([]);
    expect(readTiesAnswer({ ties: [] })).toBeNull();
  });

  it('lists each entry with its kind and other names', () => {
    const { cast } = passage('Sherlock Holmes, or Holmes, met Watson.', [['Sherlock Holmes', ['Holmes']], ['Watson']]);
    expect(cast.lines).toEqual(['Sherlock Holmes (character), also Holmes', 'Watson (character)']);
    expect(cast.narrator).toBeNull();
  });
});

describe('findQuote and nameTokens', () => {
  it('finds a quote word by word, whatever the case and punctuation between', () => {
    expect(findQuote('holmes AND watson, shared', 'Then Holmes and Watson shared rooms.')).toEqual([5, 29]);
    expect(findQuote('“Holmes”', 'Holmes')).toBeNull();
    expect(findQuote('Holmes fought', 'Holmes and Watson')).toBeNull();
  });

  it('takes words of three letters or more, without titles and role words', () => {
    expect(nameTokens(['Mr. Sherlock Holmes', 'Al', 'Doctor Watson’s'])).toEqual(new Set(['sherlock', 'holmes', 'watson']));
  });
});

describe('checkTies', () => {
  const both: SyntheticEntry[] = [['Holmes'], ['Watson']];

  it('drops a type off the list, a name off the cast, a self tie and a quote not in the passage', () => {
    const { check } = passage('Holmes and Watson shared rooms. Watson wrote.', both);
    const result = check(
      tie('Holmes', 'flatmate_of', 'Watson', 'Holmes and Watson shared rooms'),
      tie('Lestrade', 'friend_of', 'Watson', 'Holmes and Watson shared rooms'),
      tie('Holmes', 'friend_of', 'holmes', 'Holmes and Watson shared rooms'),
      tie('Holmes', 'friend_of', 'Watson', 'Holmes and Watson fought'),
      'junk',
    );
    expect(result.kept).toEqual([]);
    expect(result.dropped.map((item) => item.reason)).toEqual([
      'type not on the list',
      'name not in the cast',
      'points at itself',
      'quote not in the passage',
      'type not on the list',
    ]);
  });

  it('keeps a tie whose quote names both, reading names and types loosely', () => {
    const { check } = passage('Holmes and Watson shared rooms. Watson wrote.', both);
    expect(check(tie('Holmes (character)', 'Relation: Friend_Of', 'watson', 'holmes AND watson, shared rooms')).kept).toEqual([
      {
        a: 'Holmes',
        type: 'friend_of',
        b: 'Watson',
        aEntity: 0,
        bEntity: 1,
        quote: { passage: 'c1p1', offset: 0, text: 'Holmes and Watson shared rooms' },
        evidence: 'quote',
      },
    ]);
  });

  it('takes a side named in the paragraph before, or within the window before the quote', () => {
    const fog = 'The fog was thick. '.repeat(90);
    const quote = 'Watson moved in with him';
    expect(passage(`Holmes needed a friend.\n${quote}.`, both).check(tie('Watson', 'friend_of', 'Holmes', quote)).kept[0].evidence).toBe('paragraph');
    expect(
      passage(`Holmes needed a friend.\nThe rooms were small.\n${quote}.`, both).check(tie('Watson', 'friend_of', 'Holmes', quote)).kept[0].evidence,
    ).toBe('nearby');
    expect(
      passage(`Holmes needed a friend.\n${fog}\nThe rooms were small.\n${quote}.`, both).check(tie('Watson', 'friend_of', 'Holmes', quote)).dropped,
    ).toMatchObject([{ reason: 'a side is not named near the quote' }]);
  });

  it('reads I and my as the narrator in a first-person passage', () => {
    const told = passage(
      'I married Mary Morstan in the spring. My heart was full, and I told me so. John Watson smiled.',
      [['John Watson'], ['Mary Morstan']],
      'John Watson',
    );
    expect(told.cast.narrator).toBe('John Watson');
    expect(told.check(tie('John Watson', 'spouse_of', 'Mary Morstan', 'I married Mary Morstan')).kept).toMatchObject([{ evidence: 'quote' }]);
    const third = passage('Then he married Mary Morstan in the spring. He was glad. John Watson smiled.', [['John Watson'], ['Mary Morstan']]);
    expect(third.check(tie('John Watson', 'spouse_of', 'Mary Morstan', 'married Mary Morstan')).kept).toMatchObject([{ evidence: 'paragraph' }]);
    expect(third.cast.narrator).toBeNull();
  });

  it('needs more than a kin title for a family tie', () => {
    const text = [
      'Aunt Petunia smiled at Harry Potter.',
      'His Aunt Petunia hugged Harry Potter.',
      'Aunt Petunia, the sister of his mother, scolded Harry Potter.',
    ].join('\n');
    const { check } = passage(text, [['Aunt Petunia'], ['Harry Potter']]);
    const result = check(
      tie('Aunt Petunia', 'aunt_or_uncle_of', 'Harry Potter', 'Aunt Petunia smiled at Harry Potter'),
      tie('Aunt Petunia', 'aunt_or_uncle_of', 'Harry Potter', 'His Aunt Petunia hugged Harry Potter'),
      tie('Aunt Petunia', 'aunt_or_uncle_of', 'Harry Potter', 'Aunt Petunia, the sister of his mother, scolded Harry Potter'),
      tie('Aunt Petunia', 'enemy_of', 'Harry Potter', 'Aunt Petunia smiled at Harry Potter'),
    );
    expect(result.dropped).toMatchObject([{ reason: 'family only by a title' }]);
    expect(result.kept.map((item) => item.type)).toEqual(['aunt_or_uncle_of', 'aunt_or_uncle_of', 'enemy_of']);
  });

  it('puts the side with the kin title first', () => {
    const { check } = passage('His Aunt Petunia hugged Harry Potter.', [['Aunt Petunia'], ['Harry Potter']]);
    expect(check(tie('Harry Potter', 'aunt_or_uncle_of', 'Aunt Petunia', 'His Aunt Petunia hugged Harry Potter')).kept).toMatchObject([
      { a: 'Aunt Petunia', b: 'Harry Potter', aEntity: 0, bEntity: 1 },
    ]);
  });

  it('places a narrator filled in from the cast on its cast entity', () => {
    const text = 'I married Mary Morstan in the spring. My heart was full, and I told me so. I was glad.';
    const { cast, check } = passage(text, [['Mary Morstan']], undefined, { name: 'John Watson', names: ['John Watson', 'watson'], entity: 7 });
    expect(cast.narrator).toBe('John Watson');
    expect(cast.lines).toEqual(['Mary Morstan (character)', 'John Watson (character)']);
    expect(check(tie('Watson', 'spouse_of', 'Mary Morstan', 'I married Mary Morstan')).kept).toMatchObject([
      { a: 'John Watson', aEntity: 7, bEntity: 0 },
    ]);
  });
});

describe('narratorFill', () => {
  it('gives a first-person passage with no narrator its chapter’s, else the book’s when there is one', () => {
    const me = 'I walked. My feet hurt and I sat. Mary Morstan waved at me.';
    const text = syntheticText([
      [`${me} John Watson rested.`, me],
      [me, 'Mary Morstan walked. She was tired and her feet hurt.'],
    ]);
    const names = syntheticNames(
      text,
      { c1p1: [['John Watson'], ['Mary Morstan']], c1p2: [['Mary Morstan']], c2p1: [['Mary Morstan']], c2p2: [['Mary Morstan']] },
      { c1p1: 'John Watson' },
    );
    const merge = mergeNames(text.passages, names);
    const fill = narratorFill(text.passages, names, merge, applyReview([], merge, text));
    expect([...fill.keys()]).toEqual(['c1p2', 'c2p1']);
    expect(fill.get('c1p2')).toEqual({ name: 'John Watson', names: ['John Watson'], entity: 0 });
  });
});

describe('shipTies', () => {
  let offset = 0;
  const placed = (a: string, type: PlacedTie['type'], b: string, order = 0): PlacedTie => {
    const quote: PassageSpan = { passage: `c1p${order + 1}`, offset: offset++, text: 'quote' };
    return { a, type, b, quote, order };
  };
  const kinds: Record<string, 'character' | 'place' | 'group'> = { ann: 'character', bo: 'character', cy: 'character', inn: 'place', guild: 'group' };
  const kindOf = (key: string) => kinds[key];

  it('counts a tie once per quote, and orders the sides of a symmetric type', () => {
    const { kept } = shipTies([placed('bo', 'friend_of', 'ann', 1), placed('ann', 'friend_of', 'bo', 0), placed('ann', 'owns', 'inn')], kindOf);
    expect(kept.map((item) => [item.a, item.type, item.b, item.count, item.quotes.map((quote) => quote.passage)])).toEqual([
      ['ann', 'friend_of', 'bo', 2, ['c1p1', 'c1p2']],
      ['ann', 'owns', 'inn', 1, ['c1p1']],
    ]);
  });

  it('drops a family link found the other way as often, sides of the wrong kind, and a vague relative', () => {
    const { kept, dropped } = shipTies(
      [
        placed('ann', 'parent_of', 'bo'),
        placed('ann', 'parent_of', 'bo'),
        placed('bo', 'parent_of', 'ann'),
        placed('inn', 'lives_at', 'ann'),
        placed('ann', 'member_of', 'nobody'),
        placed('ann', 'relative_of', 'cy'),
        placed('cy', 'sibling_of', 'ann'),
        placed('ann', 'member_of', 'guild'),
      ],
      kindOf,
    );
    expect(kept.map((item) => `${item.a} ${item.type} ${item.b}`)).toEqual(['ann parent_of bo', 'ann sibling_of cy', 'ann member_of guild']);
    expect(dropped.map((item) => `${item.a} ${item.type} ${item.b}: ${item.reason}`)).toEqual([
      'bo parent_of ann: reversed family link',
      'inn lives_at ann: kind',
      'ann member_of nobody: kind',
      'ann relative_of cy: vague duplicate of a family tie',
    ]);
  });

  it('allows the kinds the shared registry allows', () => {
    for (const type of STORY_GUIDE_TIE_TYPES) {
      const { kept } = shipTies([placed('ann', type.type, 'bo')], (key) => (key === 'ann' ? type.from[0] : type.to[0]));
      expect(kept).toHaveLength(1);
    }
  });
});

describe('tiesAiStep', () => {
  const text = syntheticText([['Holmes and Watson shared rooms.', 'The fog came.']]);
  const names = syntheticNames(text, { c1p1: [['Holmes'], ['Watson']] });
  const merge = mergeNames(text.passages, names);
  const results = { text: { book: text }, names: Object.fromEntries(names), merge: { book: merge }, review: { cast: applyReview([], merge, text) } };

  it('runs each passage with a cast on the fast slot', async () => {
    const reply = JSON.stringify({ relations: [tie('Holmes', 'friend_of', 'Watson', 'Holmes and Watson shared rooms')] });
    const ctx = fakeStepContext(results, () => reply);
    const step = tiesAiStep();
    expect(step).toMatchObject({ id: 'ties', version: 2, slot: 'fast', dependsOn: ['text', 'names', 'merge', 'review'] });
    expect(step.sequential).toBeFalsy();
    expect(step.units(ctx)).toEqual([{ id: 'c1p1' }]);
    expect(step.fingerprint(ctx, { id: 'c1p1' })).toMatch(/^[0-9a-f]{64}$/);
    expect(await step.run(ctx, { id: 'c1p1' })).toMatchObject({
      passage: 'c1p1',
      narrator: null,
      kept: [{ a: 'Holmes', b: 'Watson', aEntity: 0, bEntity: 1 }],
    });
    expect(ctx.requests[0]).toMatchObject({ effort: 'medium', maxOutputTokens: 6000 });
    expect(ctx.requests[0].user).toContain('\n\nNames:\nHolmes (character)\nWatson (character)');
  });

  it('leaves a passage out after two replies with no relations', async () => {
    const ctx = fakeStepContext(results, () => '{"ties": []}');
    await expect(tiesAiStep().run(ctx, { id: 'c1p1' })).rejects.toMatchObject({ reason: 'invalid-json' });
  });
});

describe('the saved public-domain ties', () => {
  it('decides the lab’s candidates as the lab did, except where the server’s paragraphs are whole', async () => {
    const replay = await labReplay();
    const fill = narratorFill(replay.text.passages, replay.names, replay.merge, replay.review);
    let candidates = 0;
    let agree = 0;
    const differ: string[] = [];
    for (const [unit, saved] of Object.entries(replay.lab.ties)) {
      const item = replay.passageOf(Number(unit));
      const cast = tiesCast(replay.names.get(item.id)!, item.text, fill.get(item.id));
      const lab = [...saved.kept.map(() => null), ...saved.dropped.map((dropped) => dropped.reason as string)];
      [...saved.kept, ...saved.dropped].forEach((relation, index) => {
        const result = checkTies([relation], item, cast, replay.merge.placement[item.id]);
        const mine = result.kept.length > 0 ? null : result.dropped[0].reason;
        candidates++;
        if (mine === lab[index]) agree++;
        else differ.push(`${String(lab[index])} -> ${result.kept[0]?.evidence ?? String(mine)}`);
      });
    }
    // The lab's text keeps Gutenberg's hard line wraps, so its "paragraph" was one printed line. On the
    // lab's own text every decision and evidence kind matches.
    expect({ candidates, agree }).toEqual({ candidates: 77, agree: 67 });
    expect(new Set(differ.map((line) => line.split(' -> ')[0]))).toEqual(new Set(['a side is not named near the quote']));
    expect(differ.every((line) => /-> (paragraph|nearby)$/.test(line))).toBe(true);
  });

  it('ships the lab’s relations from the ties it kept, each allowed by the registry', async () => {
    const replay = await labReplay();
    const fill = narratorFill(replay.text.passages, replay.names, replay.merge, replay.review);
    const castOf = new Map(replay.review.cast.flatMap((entity) => entity.members.map((id) => [id, entity] as const)));
    const order = passageOrder(replay.text);
    const ties: PlacedTie[] = [];
    for (const [unit, saved] of Object.entries(replay.lab.ties)) {
      const item = replay.passageOf(Number(unit));
      const result = checkTies(saved.kept, item, tiesCast(replay.names.get(item.id)!, item.text, fill.get(item.id)), replay.merge.placement[item.id]);
      expect(result.kept).toHaveLength(saved.kept.length);
      for (const kept of result.kept) {
        ties.push({
          a: castOf.get(kept.aEntity)!.name,
          type: kept.type,
          b: castOf.get(kept.bEntity)!.name,
          quote: kept.quote,
          order: order.get(item.id)!,
        });
      }
    }
    const kindOf = (name: string) => replay.review.cast.find((entity) => entity.name === name)?.kind;
    const shipped = shipTies(ties, kindOf);
    const key = (relation: { a: string; type: string; b: string; count: number }) => `${relation.a}|${relation.type}|${relation.b}|${relation.count}`;
    const relations = replay.lab.relations as { a: string; type: string; b: string; count: number }[];
    expect(shipped.dropped).toEqual([]);
    expect(shipped.kept.map(key).sort()).toEqual(relations.map(key).sort());
    for (const relation of relations) {
      const info = storyGuideTieType(relation.type)!;
      expect(info.from).toContain(kindOf(relation.a));
      expect(info.to).toContain(kindOf(relation.b));
    }
  });
});
