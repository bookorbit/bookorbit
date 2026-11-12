import { labReplay } from './lab-replay.testing';
import { entityKind, mergeAiStep, mergeNames } from './merge-step';
import { fakeStepContext, syntheticNames, syntheticText, type SyntheticEntry } from './step-context.testing';

function merge(passages: string[][], entries: Record<string, readonly SyntheticEntry[]>) {
  const text = syntheticText(passages);
  return mergeNames(text.passages, syntheticNames(text, entries));
}

const names = (entity: { names: { key: string }[] }) => entity.names.map((name) => name.key);

describe('mergeNames', () => {
  it('joins entries that share a name, in reading order', () => {
    const result = merge([['Sherlock Holmes came. Holmes sat.', 'Holmes left.', 'Sherlock Holmes ran.']], {
      c1p1: [['Sherlock Holmes', ['Holmes']]],
      c1p2: [['Holmes']],
      c1p3: [['Sherlock Holmes']],
    });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({ id: 0, name: 'Sherlock Holmes', first: 'c1p1', passages: ['c1p1', 'c1p2', 'c1p3'] });
    expect(names(result.entities[0])).toEqual(['sherlock holmes', 'holmes']);
    expect(result.placement).toEqual({ c1p1: { 'sherlock holmes': 0, holmes: 0 }, c1p2: { holmes: 0 }, c1p3: { 'sherlock holmes': 0 } });
  });

  it('joins an entry whose alias is an entity name', () => {
    const result = merge([['Holmes sat.', 'Mr. Sherlock Holmes rose.']], {
      c1p1: [['Holmes']],
      c1p2: [['Mr. Sherlock Holmes', ['Holmes']]],
    });
    expect(result.entities).toHaveLength(1);
    expect(names(result.entities[0])).toEqual(['holmes', 'mr sherlock holmes']);
  });

  it('never joins two entries that only share an alias', () => {
    const result = merge([['Harry Potter and Potter.', 'Lily Potter and Potter.']], {
      c1p1: [['Harry Potter', ['Potter']]],
      c1p2: [['Lily Potter', ['Potter']]],
    });
    expect(result.entities.map((entity) => entity.name)).toEqual(['Harry Potter', 'Lily Potter']);
  });

  it('joins "House X" and "X" (or "Xs") when both are groups', () => {
    const forward = merge([['The Starks rode.', 'House Stark held.']], {
      c1p1: [['Starks', [], 'group']],
      c1p2: [['House Stark', [], 'group']],
    });
    expect(forward.entities).toHaveLength(1);
    expect(names(forward.entities[0])).toEqual(['starks', 'house stark']);

    const backward = merge([['House Lannister paid.', 'Lannister gold.']], {
      c1p1: [['House Lannister', [], 'group']],
      c1p2: [['Lannister', [], 'group']],
    });
    expect(backward.entities).toHaveLength(1);
  });

  it('keeps "House X" apart from a person called X', () => {
    const result = merge([['Stark nodded.', 'House Stark held.']], {
      c1p1: [['Stark', [], 'character']],
      c1p2: [['House Stark', [], 'group']],
    });
    expect(result.entities.map((entity) => entity.name)).toEqual(['Stark', 'House Stark']);
  });

  it('never joins a full name to a person whose name conflicts, nor takes that name as an alias', () => {
    const result = merge([['Harry Potter waved.', 'James Potter, not Harry Potter, came.']], {
      c1p1: [['Harry Potter']],
      c1p2: [['James Potter', ['Harry Potter']]],
    });
    expect(result.entities.map((entity) => entity.name)).toEqual(['Harry Potter', 'James Potter']);
    expect(names(result.entities[1])).toEqual(['james potter']);
  });

  it('gives a bare first name to the one its entry names, else to the namesake seen last in the chapter', () => {
    const result = merge([['John Ferrier and John Rance met.', 'John Ferrier spoke.', 'John laughed.', 'John Rance, or John, left.']], {
      c1p1: [['John Ferrier'], ['John Rance']],
      c1p2: [['John Ferrier']],
      c1p3: [['John']],
      c1p4: [['John', ['John Rance']]],
    });
    expect(result.entities.map((entity) => entity.name)).toEqual(['John Ferrier', 'John Rance']);
    expect(result.placement.c1p3).toEqual({ john: 0 });
    expect(result.placement.c1p4).toEqual({ john: 1, 'john rance': 1 });
  });

  it('takes the kind most entries gave, ties to the first', () => {
    const result = merge([['Baker Street. Baker Street.', 'Baker Street!', 'Baker Street?']], {
      c1p1: [['Baker Street', [], 'place']],
      c1p2: [['Baker Street', [], 'object']],
      c1p3: [['Baker Street', [], 'object']],
    });
    expect(entityKind(result.entities[0])).toBe('object');
    expect(
      entityKind({
        kinds: [
          { passage: 'a', kind: 'place' },
          { passage: 'b', kind: 'group' },
        ],
      }),
    ).toBe('place');
  });
});

describe('narrators', () => {
  const book = (narrators: Record<string, string>) => {
    const text = syntheticText([['Lenù spoke.', 'Lenuccia spoke.', 'Lenù spoke again.', 'Lila spoke.']]);
    const names = syntheticNames(text, { c1p1: [['Lenù']], c1p2: [['Lenuccia']], c1p3: [['Lenù']], c1p4: [['Lila']] }, narrators);
    return mergeNames(text.passages, names);
  };

  it('counts the passages that name an entity as the one telling them', () => {
    const { entities } = book({ c1p1: 'Lenù', c1p2: 'Lenuccia', c1p3: 'Lenù' });
    expect(entities.map((entity) => [entity.name, entity.narrated])).toEqual([
      ['Lenù', 2],
      ['Lenuccia', 1],
      ['Lila', undefined],
    ]);
  });

  it('marks nobody in a book told in the third person', () => {
    expect(book({}).entities.every((entity) => entity.narrated === undefined)).toBe(true);
  });
});

describe('mergeAiStep', () => {
  it('runs once for the book in code, after names', async () => {
    const text = syntheticText([['Mary sat.', 'Mary left.']]);
    const results = Object.fromEntries(syntheticNames(text, { c1p1: [['Mary']], c1p2: [['Mary']] }));
    const ctx = fakeStepContext({ text: { book: text }, names: results });
    const step = mergeAiStep();
    expect(step).toMatchObject({ id: 'merge', version: 2, slot: null, dependsOn: ['text', 'names'] });
    expect(step.units(ctx)).toEqual([{ id: 'book' }]);
    expect(await step.run(ctx, { id: 'book' })).toEqual(mergeNames(text.passages, new Map(Object.entries(results))));
    expect(ctx.requests).toHaveLength(0);
  });
});

describe('the saved public-domain run', () => {
  it('merges into the lab entities and places every name where the lab did', async () => {
    const replay = await labReplay();
    expect(replay.merge.entities).toHaveLength(263);
    const placement = Object.fromEntries(Object.entries(replay.lab.placement).map(([unit, placed]) => [replay.passageOf(Number(unit)).id, placed]));
    expect(replay.merge.placement).toEqual(placement);
  });

  it('marks the narrators: Watson under three names for the review to join, and Jefferson Hope apart', async () => {
    const { merge } = await labReplay();
    expect(merge.entities.filter((entity) => entity.narrated).map((entity) => [entity.name, entity.narrated])).toEqual([
      ['Watson', 1],
      ['Dr. Watson', 3],
      ['Doctor Watson', 1],
      ['Jefferson Hope', 1],
    ]);
  });
});
