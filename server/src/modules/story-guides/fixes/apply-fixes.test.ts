import { readFileSync } from 'fs';
import { join } from 'path';

import type { StoryGuidePayloadV1 } from '@bookorbit/types';

import { FIXTURES_DIR } from '../testing/story-guide-fixtures';
import { applyStoryGuideFixes, compareAnchors, type StoryGuideFixInput } from './apply-fixes';

/** The shared fixture, with three more story sections so a fix can start later than the cast. */
function guide(): StoryGuidePayloadV1 {
  const payload = JSON.parse(readFileSync(join(FIXTURES_DIR, 'story-guide-payload.json'), 'utf8')) as StoryGuidePayloadV1;
  payload.sections.push({ s: 5, title: 'Chapter 3', chars: 10, h: '00000000' }, { s: 7, title: 'Chapter 4', chars: 10, h: '00000000' });
  return payload;
}

let next = 0;
function fix(kind: string, key: string, data: Record<string, unknown> = {}, extra: Partial<StoryGuideFixInput> = {}): StoryGuideFixInput {
  next += 1;
  return { id: `fix-${next}`, kind, target: { key, names: [] }, data, from: null, ...extra };
}

function apply(...fixes: StoryGuideFixInput[]) {
  return applyStoryGuideFixes(guide(), fixes);
}

function entity(payload: StoryGuidePayloadV1, key: string) {
  return payload.entities.find((candidate) => candidate.key === key);
}

describe('applyStoryGuideFixes', () => {
  it('leaves the payload it was given alone', () => {
    const payload = guide();
    const before = JSON.stringify(payload);
    applyStoryGuideFixes(payload, [fix('hide', 'violetta')]);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it('passes the chapter summaries through unchanged', () => {
    const summaries = guide().summaries;
    expect(summaries).toHaveLength(2);
    const { payload } = apply(
      fix('hide', 'violetta'),
      fix('rename', 'tom-2', { name: 'tom' }),
      fix('line', 'lord-leverance', { text: 'Owner of the egg' }, { from: { s: 7, o: 0 } }),
    );
    expect(payload.summaries).toEqual(summaries);
  });

  it('hides an entity with its joins and every tie that names them', () => {
    const { payload, outcomes } = apply(fix('hide', 'violetta'));
    expect(entity(payload, 'violetta')).toBeUndefined();
    expect(payload.ties.map((tie) => tie.key)).toEqual(['tom|friend_of|tom-2']);
    expect([...outcomes.values()]).toEqual([{ applied: true, key: 'violetta', via: 'key' }]);
  });

  it('hides a join only, with its ties', () => {
    const { payload } = apply(fix('hide', 'the-masked-girl'));
    expect(entity(payload, 'violetta')).toMatchObject({ joins: [], fixed: true });
    expect(payload.ties.map((tie) => tie.key)).not.toContain('lord-leverance|enemy_of|the-masked-girl');
    expect(payload.ties.map((tie) => tie.key)).toContain('violetta|loves|tom');
  });

  it('renames to a name the book uses without adding one, and to a new name from where it was picked', () => {
    const { payload } = apply(
      fix('rename', 'tom-2', { name: 'tom' }),
      fix('rename', 'lord-leverance', { name: 'The Lord' }, { from: { s: 7, o: 120 } }),
    );
    expect(entity(payload, 'tom-2')).toMatchObject({ name: 'tom', names: [{ text: 'TOM' }], fixed: true });
    // From chapter 4, which starts where the story section before it ends.
    expect(entity(payload, 'lord-leverance')?.names).toEqual([
      { text: 'Lord Leverance', at: { s: 3, o: 45, q: 'Lord  Leverance' } },
      { text: 'The Lord', at: { s: 5, end: true } },
    ]);
  });

  it('never starts added text before the entry is first named', () => {
    const { payload } = apply(fix('rename', 'tom-2', { name: 'Smaug' }, { from: { s: 3, o: 0 } }));
    expect(entity(payload, 'tom-2')?.names[1]).toEqual({ text: 'Smaug', at: { s: 4, o: 74, q: 'TOM' } });
  });

  it('moves an entity between tabs and to a finer guide kind', () => {
    const { payload } = apply(
      fix('kind', 'tom-2', { kind: 'term' }),
      fix('kind', 'lord-leverance', { kind: 'place' }),
      fix('guide-kind', 'tom', { kind: 'group' }),
      fix('guide-kind', 'the-masked-girl', { kind: 'object' }),
    );
    expect(payload.entities.map((item) => [item.key, item.kind])).toEqual([
      ['violetta', 'object'],
      ['lord-leverance', 'place'],
      ['tom', 'group'],
      ['tom-2', 'idea'],
    ]);
  });

  it('orphans a kind the guide does not have', () => {
    const { outcomes } = apply(fix('guide-kind', 'tom', { kind: 'planet' }), fix('kind', 'tom', { kind: 'group' }));
    expect([...outcomes.values()]).toEqual([{ applied: false }, { applied: false }]);
  });

  it('merges an entity into another as a join from its first name, dropping the tie between them', () => {
    const { payload } = apply(fix('merge', 'tom-2', { into: { key: 'tom', names: [] } }));
    expect(entity(payload, 'tom-2')).toBeUndefined();
    expect(entity(payload, 'tom')).toMatchObject({
      fixed: true,
      joins: [{ key: 'tom-2', name: 'TOM', at: { s: 4, o: 74, q: 'TOM' }, lines: [{ text: 'A sleeping dragon' }] }],
    });
    expect(payload.ties.map((tie) => tie.key)).not.toContain('tom|friend_of|tom-2');
  });

  it('merges from a picked chapter, and a later fix finds the merged entry as a join', () => {
    const { payload, outcomes } = apply(
      fix('merge', 'tom', { into: { key: 'violetta', names: [] } }, { from: { s: 5, o: 3 } }),
      fix('rename', 'tom', { name: 'Young Tom' }),
    );
    const violetta = entity(payload, 'violetta')!;
    expect(violetta.joins.map((join) => [join.key, join.at])).toEqual([
      ['the-masked-girl', { s: 4, o: 11, q: 'The masked girl was Violetta' }],
      ['tom', { s: 4, end: true }],
    ]);
    expect(violetta.joins[1].name).toBe('Young Tom');
    expect([...outcomes.values()].every((outcome) => outcome.applied)).toBe(true);
  });

  it('splits a join out into an entity of its own, keeping its key', () => {
    const { payload } = apply(fix('split', 'violetta', { name: 'The Masked Girl' }));
    expect(entity(payload, 'violetta')?.joins).toEqual([]);
    expect(payload.entities.map((item) => item.key)).toEqual(['the-masked-girl', 'violetta', 'lord-leverance', 'tom', 'tom-2']);
    expect(entity(payload, 'the-masked-girl')).toMatchObject({ kind: 'character', fixed: true, lines: [{ text: 'Thief who takes the egg' }] });
  });

  it('splits one of an entity name out under a new key, and orphans a split of its only name', () => {
    const payload = guide();
    payload.entities[1].names.push({ text: 'Tom', at: { s: 4, o: 2, q: 'Tom' } });
    const { payload: fixed, outcomes } = applyStoryGuideFixes(payload, [
      fix('split', 'lord-leverance', { name: 'Tom' }),
      fix('split', 'tom', { name: 'Tom' }),
    ]);
    expect(fixed.entities.find((item) => item.key === 'tom-3')).toMatchObject({ name: 'Tom', names: [{ at: { s: 4, o: 2 } }] });
    expect(entity(fixed, 'lord-leverance')?.names.map((name) => name.text)).toEqual(['Lord Leverance']);
    expect([...outcomes.values()].map((outcome) => outcome.applied)).toEqual([true, false]);
  });

  it('replaces a line where it stood, and adds one from a picked chapter', () => {
    const { payload } = apply(
      fix('line', 'violetta', { text: 'The thief', through: { s: 3, end: true } }),
      fix('line', 'lord-leverance', { text: 'Owner of the egg' }, { from: { s: 7, o: 0 } }),
      fix('line', 'the-masked-girl', { text: 'A thief' }, { from: { s: 3, o: 40 } }),
    );
    expect(entity(payload, 'violetta')?.lines.map((line) => line.text)).toEqual(['The thief', 'Daughter of Lord Leverance who stole the egg']);
    expect(entity(payload, 'lord-leverance')?.lines).toEqual([{ through: { s: 5, end: true }, text: 'Owner of the egg' }]);
    expect(entity(payload, 'violetta')?.joins[0].lines).toEqual([
      { through: { s: 3, o: 11, q: 'The masked girl' }, text: 'A thief' },
      { through: { s: 3, end: true }, text: 'Thief who takes the egg' },
    ]);
    // The profile at the same end takes the fixed text, so the entry page shows it too.
    expect(entity(payload, 'violetta')?.profiles?.map((profile) => profile.text)).toEqual([
      'The thief',
      'The daughter of Lord Leverance, and the masked thief who stole his egg.',
    ]);
    expect(entity(payload, 'lord-leverance')?.profiles).toEqual([{ through: { s: 5, end: true }, text: 'Owner of the egg' }]);
  });

  it('leaves profiles absent from a guide built before them', () => {
    const payload = guide();
    for (const item of payload.entities) delete item.profiles;
    const fixed = applyStoryGuideFixes(payload, [fix('line', 'violetta', { text: 'The thief', through: { s: 3, end: true } })]).payload;
    expect(entity(fixed, 'violetta')?.profiles).toBeUndefined();
  });

  it('moves profiles with an entry merged into another and with a join split off', () => {
    const merged = apply(fix('merge', 'tom-2', { into: { key: 'violetta', names: [] } })).payload;
    expect(entity(merged, 'violetta')?.joins.find((join) => join.key === 'tom-2')?.profiles).toEqual(entity(guide(), 'tom-2')?.profiles);
    const split = apply(fix('split', 'violetta', { name: 'the masked girl' })).payload;
    expect(entity(split, 'the-masked-girl')?.profiles).toEqual([
      { through: { s: 3, end: true }, text: 'A thief in a mask who takes the egg from Lord Leverance.' },
    ]);
  });

  it('removes a line, and orphans the removal of a line that is gone', () => {
    const { payload, outcomes } = apply(
      fix('line-hide', 'violetta', { through: { s: 4, end: true } }),
      fix('line-hide', 'tom', { through: { s: 4, end: true } }),
    );
    expect(entity(payload, 'violetta')?.lines.map((line) => line.text)).toEqual(['Daughter of Lord Leverance']);
    expect(entity(payload, 'violetta')?.profiles?.map((profile) => profile.text)).toEqual(['The daughter of Lord Leverance.']);
    expect([...outcomes.values()].map((outcome) => outcome.applied)).toEqual([true, false]);
  });

  it('hides a tie, retypes one in key order for a symmetric type, and merges into a tie already there', () => {
    const { payload } = apply(
      fix('tie-hide', 'lord-leverance|enemy_of|the-masked-girl'),
      fix('tie-type', 'violetta|loves|tom', { type: 'spouse_of' }),
      fix('tie-type', 'tom|friend_of|tom-2', { type: 'sibling_of' }),
    );
    expect(payload.ties.map((tie) => [tie.key, tie.label, tie.fixed])).toEqual([
      ['lord-leverance|parent_of|violetta', 'parent of', false],
      ['tom|sibling_of|tom-2', 'sibling of', true],
      ['tom|spouse_of|violetta', 'spouse of', true],
    ]);
  });

  it('adds a tie from where both sides are named, and orphans an unknown type', () => {
    const { payload, outcomes } = apply(
      fix('tie-add', 'tom-2', { type: 'enemy_of', b: { key: 'lord-leverance', names: [] } }, { from: { s: 3, o: 0 } }),
      fix('tie-add', 'tom', { type: 'nemesis_of', b: { key: 'violetta', names: [] } }),
    );
    expect(payload.ties.at(-1)).toEqual({
      key: 'lord-leverance|enemy_of|tom-2',
      a: 'lord-leverance',
      type: 'enemy_of',
      b: 'tom-2',
      label: 'enemy of',
      at: { s: 4, o: 74, q: 'TOM' },
      quotes: [],
      count: 0,
      fixed: true,
    });
    expect([...outcomes.values()].map((outcome) => outcome.applied)).toEqual([true, false]);
  });

  describe('after a Rebuild', () => {
    /** The same cast with new keys: Violetta now goes by her title, and Lord Leverance is gone. */
    function rebuilt(): StoryGuidePayloadV1 {
      const payload = guide();
      const violetta = payload.entities[0];
      violetta.key = 'lady-violetta';
      violetta.name = 'Lady Violetta';
      violetta.names.push({ text: 'Lady Violetta', at: { s: 4, o: 30, q: 'Lady Violetta' } });
      payload.entities.splice(1, 1);
      payload.ties = payload.ties
        .filter((tie) => !tie.key.includes('lord-leverance'))
        .map((tie) => (tie.a === 'violetta' ? { ...tie, a: 'lady-violetta', key: tie.key.replace('violetta|', 'lady-violetta|') } : tie));
      return payload;
    }

    it('finds a fix by key, then by former names, and orphans one with neither', () => {
      const fixes = [
        { ...fix('line', 'tom', { text: 'Keeps watch' }, { from: { s: 4, o: 0 } }), target: { key: 'tom', names: ['tom'] } },
        { ...fix('rename', 'violetta', { name: 'Vi' }), target: { key: 'violetta', names: ['violetta'] } },
        { ...fix('hide', 'lord-leverance'), target: { key: 'lord-leverance', names: ['lord-leverance'] } },
        { ...fix('tie-type', 'violetta|loves|tom', { type: 'betrothed_to', a: ['violetta'] }) },
      ];
      const { payload, outcomes } = applyStoryGuideFixes(rebuilt(), fixes);
      expect([...outcomes.values()]).toEqual([
        { applied: true, key: 'tom', via: 'key' },
        { applied: true, key: 'lady-violetta', via: 'names' },
        { applied: false },
        { applied: true, key: 'lady-violetta|loves|tom', via: 'names' },
      ]);
      expect(entity(payload, 'lady-violetta')?.name).toBe('Vi');
      expect(payload.ties.map((tie) => tie.key)).toContain('lady-violetta|betrothed_to|tom');
    });

    it('follows a hide by former names only when two of them agree, and orphans it on one', () => {
      const hideBy = (names: string[]) => applyStoryGuideFixes(rebuilt(), [{ ...fix('hide', 'violetta'), target: { key: 'violetta', names } }]);
      const agreeing = hideBy(['violetta', 'Lady Violetta']);
      expect([...agreeing.outcomes.values()]).toEqual([{ applied: true, key: 'lady-violetta', via: 'names' }]);
      expect(entity(agreeing.payload, 'lady-violetta')).toBeUndefined();
      for (const names of [['violetta'], ['violetta', 'the masked lady']]) {
        const alone = hideBy(names);
        expect([...alone.outcomes.values()]).toEqual([{ applied: false }]);
        expect(entity(alone.payload, 'lady-violetta')).toBeDefined();
      }
    });

    it('keeps following other fixes by a single former name', () => {
      const { outcomes } = applyStoryGuideFixes(rebuilt(), [
        { ...fix('rename', 'violetta', { name: 'Vi' }), target: { key: 'violetta', names: ['violetta'] } },
      ]);
      expect([...outcomes.values()]).toEqual([{ applied: true, key: 'lady-violetta', via: 'names' }]);
    });

    it('still hides by key when the names are few', () => {
      const { outcomes } = applyStoryGuideFixes(guide(), [{ ...fix('hide', 'violetta'), target: { key: 'violetta', names: ['violetta'] } }]);
      expect([...outcomes.values()]).toEqual([{ applied: true, key: 'violetta', via: 'key' }]);
    });

    it('orphans a fix whose former names fit two entries equally', () => {
      const { outcomes } = applyStoryGuideFixes(rebuilt(), [{ ...fix('hide', 'gone'), target: { key: 'gone', names: ['tom'] } }]);
      expect([...outcomes.values()]).toEqual([{ applied: false }]);
    });
  });
});

describe('compareAnchors', () => {
  it('orders by section, then offset, with a section end after every offset in it', () => {
    const anchors = [
      { s: 4, o: 2, q: 'a' },
      { s: 3, end: true as const },
      { s: 3, o: 90, q: 'b' },
      { s: 4, end: true as const },
    ];
    expect([...anchors].sort(compareAnchors)).toEqual([anchors[2], anchors[1], anchors[0], anchors[3]]);
  });
});
