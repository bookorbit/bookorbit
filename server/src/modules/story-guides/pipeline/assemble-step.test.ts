import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { FIXTURES_DIR } from '../testing/story-guide-fixtures';
import { sectionHash } from '../text/section-text';
import { StoryAnchors } from './anchors';
import { labReplay } from './lab-replay.testing';
import { assembleStoryGuide, storyGuideKey, type AssembleInput } from './assemble-step';
import type {
  PassageSpan,
  StoryLinesResult,
  StoryMergeResult,
  StoryProfilesResult,
  StoryReviewResult,
  StorySummaryResult,
  StoryTie,
  StoryTiesResult,
} from './story-guide.types';
import { chapterPassages, storyLines, type StoryChapter, type TextStepResult } from './text-step';

/** The payload clients decode in their own tests. Rewrite it with `WRITE_STORY_GUIDE_FIXTURE=1` after a deliberate change. */
const PAYLOAD_FIXTURE = join(FIXTURES_DIR, 'story-guide-payload.json');

function chapter(number: number, s: number, blocks: string[]): { chapter: StoryChapter; raw: string } {
  const raw = blocks.join('');
  const starts = blocks.map((_, index) => blocks.slice(0, index).join('').length);
  return {
    raw,
    chapter: {
      number,
      s,
      title: `Chapter ${number}`,
      start: 0,
      end: raw.length,
      lines: storyLines(raw, starts, 0, raw.length),
      parts: [{ part: 1, start: 0, end: raw.length }],
    },
  };
}

/** A two-chapter book: a masked girl is revealed as Violetta in chapter 2. */
function book() {
  const one = chapter(1, 3, [
    'Chapter One',
    'The masked girl took the egg from Lord  Leverance.',
    'Violetta, his daughter, slept while Tom kept watch.',
  ]);
  const two = chapter(2, 4, ['Chapter Two', 'The masked girl was Violetta all along.', 'Violetta loves Tom, and TOM the dragon sleeps.']);
  const text: TextStepResult = {
    key: 'k'.repeat(64),
    chapters: [one.chapter, two.chapter],
    passages: [one.chapter, two.chapter].flatMap(chapterPassages),
  };
  const raw = new Map([
    [3, one.raw],
    [4, two.raw],
  ]);
  const span = (passage: string, words: string, from = 0): PassageSpan => {
    const source = text.passages.find((item) => item.id === passage)!.text;
    return { passage, offset: source.indexOf(words, from), text: words };
  };
  const entity = (id: number, name: string, at: PassageSpan, kind: 'character' = 'character') => ({
    id,
    name,
    first: at.passage,
    names: [{ key: name.toLowerCase(), text: name, at }],
    kinds: [{ passage: at.passage, kind }],
    what: [],
    passages: [at.passage],
  });
  const merge: StoryMergeResult = {
    entities: [
      entity(0, 'the masked girl', span('c1p1', 'The masked girl')),
      entity(1, 'Lord Leverance', span('c1p1', 'Lord Leverance')),
      entity(2, 'Violetta', span('c1p1', 'Violetta')),
      entity(3, 'Tom', span('c1p1', 'Tom')),
      entity(4, 'TOM', span('c2p1', 'TOM')),
    ],
    placement: {},
  };
  merge.entities[2].names.push({ key: 'lady violetta', text: 'Lady Violetta', at: { passage: 'c2p1', offset: 999, text: 'Lady Violetta' } });
  const review: StoryReviewResult = {
    groups: [{ ids: [0, 2], from: 2, modelFrom: 2 }],
    joins: [{ member: 0, into: 2, chapter: 2, at: span('c2p1', 'The masked girl was Violetta'), reveal: true }],
    blocked: [],
    cast: [
      { id: 2, name: 'Violetta', kind: 'character', members: [2, 0] },
      { id: 1, name: 'Lord Leverance', kind: 'character', members: [1] },
      { id: 3, name: 'Tom', kind: 'character', members: [3] },
      { id: 4, name: 'TOM', kind: 'character', members: [4] },
    ],
  };
  const tie = (a: [string, number], type: StoryTie['type'], b: [string, number], quote: PassageSpan): StoryTie => ({
    a: a[0],
    type,
    b: b[0],
    aEntity: a[1],
    bEntity: b[1],
    quote,
    evidence: 'quote',
  });
  const ties: StoryTiesResult[] = [
    {
      passage: 'c2p1',
      narrator: null,
      kept: [
        tie(['Violetta', 2], 'loves', ['Tom', 3], span('c2p1', 'Violetta loves Tom')),
        tie(['the masked girl', 0], 'enemy_of', ['Violetta', 2], span('c2p1', 'The masked girl was Violetta')),
        tie(['TOM', 4], 'friend_of', ['Tom', 3], span('c2p1', 'Tom, and TOM')),
        tie(['the masked girl', 0], 'loves', ['Tom', 3], span('c2p1', 'The masked girl was Violetta all along')),
      ],
      dropped: [],
    },
    {
      passage: 'c1p1',
      narrator: null,
      kept: [
        tie(['Lord Leverance', 1], 'parent_of', ['Violetta', 2], span('c1p1', 'Violetta, his daughter')),
        tie(['the masked girl', 0], 'enemy_of', ['Lord Leverance', 1], span('c1p1', 'The masked girl took the egg from Lord')),
        tie(['Tom', 3], 'friend_of', ['TOM', 4], span('c1p1', 'Tom kept watch')),
      ],
      dropped: [],
    },
  ];
  const lines: StoryLinesResult[] = [
    {
      through: { chapter: 2, part: null },
      lines: [
        { entity: 2, name: 'Violetta', text: 'Daughter of Lord Leverance who stole the egg' },
        { entity: 4, name: 'TOM', text: 'A sleeping dragon' },
      ],
      dropped: [],
      rewritten: 0,
    },
    {
      through: { chapter: 1, part: null },
      lines: [
        { entity: 0, name: 'the masked girl', text: 'Thief who takes the egg' },
        { entity: 2, name: 'Violetta', text: 'Daughter of Lord Leverance' },
      ],
      dropped: [],
      rewritten: 0,
    },
  ];
  const profiles: StoryProfilesResult[] = [
    {
      through: { chapter: 1, part: null },
      profiles: [
        { entity: 0, name: 'the masked girl', text: 'A thief in a mask who takes the egg from Lord Leverance.' },
        { entity: 2, name: 'Violetta', text: 'The daughter of Lord Leverance.' },
        { entity: 9, name: 'Nobody', text: 'Left out: no such entity is shown.' },
      ],
      dropped: [],
      rewritten: 0,
    },
    {
      through: { chapter: 2, part: null },
      profiles: [{ entity: 2, name: 'Violetta', text: 'The daughter of Lord Leverance, and the masked thief who stole his egg.' }],
      dropped: [],
      rewritten: 0,
    },
  ];
  const summaries: StorySummaryResult[] = [
    { through: { chapter: 2, part: null }, text: 'The masked girl turns out to be Violetta, who loves Tom.', dropped: null, rewritten: false },
    { through: { chapter: 9, part: null }, text: 'Left out: the book has no chapter 9.', dropped: null, rewritten: false },
    {
      through: { chapter: 1, part: null },
      text: 'A masked girl takes the egg from Lord Leverance while his daughter Violetta sleeps.',
      dropped: null,
      rewritten: false,
    },
  ];
  const input: AssembleInput = {
    textKey: text.key,
    pipeline: 'x1.te1.na1.me1.re1.ti1.li1.as1',
    builtAt: '2026-11-09T10:00:00.000Z',
    language: 'en',
    models: { fast: 'fast-model', careful: 'careful-model' },
    coverage: 1,
    sections: [
      { s: 3, title: 'Chapter 1', chars: one.raw.length, h: sectionHash(one.raw), start: 0, end: one.raw.length, words: 20 },
      { s: 4, title: 'Chapter 2', chars: two.raw.length, h: sectionHash(two.raw), start: 0, end: two.raw.length, words: 20 },
    ] as AssembleInput['sections'],
    text,
    raw,
    merge,
    review,
    ties,
    lines,
    profiles,
    summaries,
  };
  return { input, raw };
}

describe('storyGuideKey', () => {
  it.each([
    ['Violetta', 'violetta'],
    ["Lady Violetta's", 'lady-violetta'],
    ['Émile  Zola', 'emile-zola'],
    ['Ｔｏｍ', 'tom'],
    ['Dr. Watson', 'dr-watson'],
    ['O\u2019Brien', 'obrien'],
    ['!!!', 'entry'],
  ])('folds %j to %j', (name, key) => {
    expect(storyGuideKey(name)).toBe(key);
  });
});

describe('assembleStoryGuide', () => {
  const { input, raw } = book();
  const { payload, dropped } = assembleStoryGuide(input);
  const violetta = payload.entities.find((entity) => entity.key === 'violetta')!;

  it('shows a group as the member whose name it took, the other joining at the reveal', () => {
    expect(payload.entities.map((entity) => entity.key)).toEqual(['violetta', 'lord-leverance', 'tom', 'tom-2']);
    expect(violetta.name).toBe('Violetta');
    expect(violetta.joins).toHaveLength(1);
    expect(violetta.joins[0]).toMatchObject({ key: 'the-masked-girl', name: 'the masked girl', at: { s: 4, q: 'The masked girl was Violetta' } });
  });

  it('anchors every name in the raw text, as written there', () => {
    expect(violetta.names).toEqual([{ text: 'Violetta', at: { s: 3, o: raw.get(3)!.indexOf('Violetta'), q: 'Violetta' } }]);
    const lord = payload.entities.find((entity) => entity.key === 'lord-leverance')!;
    expect(lord.names[0].at).toEqual({ s: 3, o: raw.get(3)!.indexOf('Lord'), q: 'Lord  Leverance' });
    expect(dropped).toEqual({ names: 1, entries: 0, lines: 0, profiles: 1, summaries: 1, quotes: 0 });
  });

  it("keeps a member's lines until its join, and the group's under the shown entity after", () => {
    expect(violetta.joins[0].lines).toEqual([{ through: { s: 3, end: true }, text: 'Thief who takes the egg' }]);
    expect(violetta.lines).toEqual([
      { through: { s: 3, end: true }, text: 'Daughter of Lord Leverance' },
      { through: { s: 4, end: true }, text: 'Daughter of Lord Leverance who stole the egg' },
    ]);
  });

  it("keeps profiles as lines are kept: a member's until its join, the shown entity's in chapter order", () => {
    expect(violetta.joins[0].profiles).toEqual([{ through: { s: 3, end: true }, text: 'A thief in a mask who takes the egg from Lord Leverance.' }]);
    expect(violetta.profiles).toEqual([
      { through: { s: 3, end: true }, text: 'The daughter of Lord Leverance.' },
      { through: { s: 4, end: true }, text: 'The daughter of Lord Leverance, and the masked thief who stole his egg.' },
    ]);
    expect(payload.entities.find((entity) => entity.key === 'tom')!.profiles).toEqual([]);
  });

  it('keeps the summaries in reading order, each holding from the end of its chapter', () => {
    expect(payload.summaries).toEqual([
      { through: { s: 3, end: true }, text: 'A masked girl takes the egg from Lord Leverance while his daughter Violetta sleeps.' },
      { through: { s: 4, end: true }, text: 'The masked girl turns out to be Violetta, who loves Tom.' },
    ]);
  });

  it('stamps a part of a long chapter with its last words, and leaves out a unit whose summary failed', () => {
    const [one, two] = input.text.chapters;
    const cut = one.lines[2].at;
    const text = {
      ...input.text,
      chapters: [
        {
          ...one,
          parts: [
            { part: 1, start: one.start, end: cut },
            { part: 2, start: cut, end: one.end },
          ],
        },
        two,
      ],
    };
    const failed: StorySummaryResult = {
      through: { chapter: 2, part: null },
      text: null,
      dropped: { text: 'Lady Violetta wears the mask.', reason: 'names-later-entity' },
      rewritten: true,
    };
    const result = assembleStoryGuide({
      ...input,
      text,
      summaries: [
        { through: { chapter: 1, part: 2 }, text: 'Violetta sleeps while Tom keeps watch.', dropped: null, rewritten: false },
        failed,
        { through: { chapter: 1, part: 1 }, text: 'A masked girl takes the egg from Lord Leverance.', dropped: null, rewritten: false },
      ],
    });
    const partEnd = new StoryAnchors(text, raw).through({ chapter: 1, part: 1 });
    expect(partEnd).toMatchObject({ s: 3, q: expect.stringContaining('Leverance') });
    expect(result.payload.summaries).toEqual([
      { through: partEnd, text: 'A masked girl takes the egg from Lord Leverance.' },
      { through: { s: 3, end: true }, text: 'Violetta sleeps while Tom keeps watch.' },
    ]);
    expect(result.dropped.summaries).toBe(0);
  });

  it('keys ties by their sides, orders symmetric ones, counts repeats and drops a tie inside one entity', () => {
    expect(payload.ties.map((tie) => tie.key)).toEqual([
      'lord-leverance|enemy_of|the-masked-girl',
      'lord-leverance|parent_of|violetta',
      'tom|friend_of|tom-2',
      'violetta|loves|tom',
    ]);
    const friends = payload.ties.find((tie) => tie.type === 'friend_of')!;
    expect(friends).toMatchObject({ a: 'tom', b: 'tom-2', label: 'friend of', count: 2 });
    expect(friends.quotes).toHaveLength(2);
    expect(friends.at).toEqual(friends.quotes[0]);
    expect(friends.at).toMatchObject({ s: 3, q: 'Tom kept watch' });
  });

  it('names a member in a tie by its own key before its join, and by the entity it joins after', () => {
    expect(payload.ties[0]).toMatchObject({ a: 'lord-leverance', b: 'the-masked-girl', at: { s: 3 } });
    const loves = payload.ties.find((tie) => tie.type === 'loves')!;
    expect(loves).toMatchObject({ a: 'violetta', b: 'tom', count: 2, at: { s: 4, q: 'The masked girl was Violetta all along' } });
  });

  it('matches the shared fixture clients decode', () => {
    const json = JSON.stringify(payload, null, 2) + '\n';
    if (process.env.WRITE_STORY_GUIDE_FIXTURE === '1') writeFileSync(PAYLOAD_FIXTURE, json);
    expect(json).toBe(readFileSync(PAYLOAD_FIXTURE, 'utf8'));
  });

  it('anchors the public-domain cast: every located name maps back to its words', async () => {
    const replay = await labReplay();
    const { book: epub } = await (await import('../testing/story-guide-fixtures')).publicDomainText();
    const result = assembleStoryGuide({
      ...input,
      sections: [],
      text: replay.text,
      raw: new Map(epub.sections.map((section) => [section.index, section.text])),
      merge: replay.merge,
      review: replay.review,
      ties: [],
      lines: [],
    });
    const passageText = new Map(replay.text.passages.map((passage) => [passage.id, passage.text]));
    const unplaceable = replay.merge.entities
      .flatMap((entity) => entity.names)
      .filter((name) => passageText.get(name.at.passage)!.slice(name.at.offset, name.at.offset + name.at.text.length) !== name.at.text);
    expect(unplaceable.length).toBeLessThanOrEqual(replay.unlocated.length);
    expect(result.dropped.names).toBe(unplaceable.length);
    // An entry whose every name is unplaceable is left out; the lab's text keeps hard line wraps.
    const homeless = replay.merge.entities.filter((entity) => entity.names.every((name) => unplaceable.includes(name)));
    expect(result.dropped.entries).toBe(homeless.length);
    expect(result.payload.entities.length + result.payload.entities.reduce((sum, entity) => sum + entity.joins.length, 0)).toBe(
      replay.merge.entities.length - homeless.length,
    );
    expect(new Set(result.payload.entities.map((entity) => entity.key)).size).toBe(result.payload.entities.length);
    for (const entity of result.payload.entities) {
      for (const name of [...entity.names, ...entity.joins.flatMap((join) => join.names)]) {
        if (!('q' in name.at)) throw new Error('a name anchor is a section end');
        const sectionText = epub.sections[name.at.s].text;
        expect(sectionText.slice(name.at.o, name.at.o + name.at.q.length)).toBe(name.at.q);
        expect(name.at.q.replace(/\s+/g, ' ')).toBe(name.text.replace(/\s+/g, ' '));
      }
    }
  });
});
