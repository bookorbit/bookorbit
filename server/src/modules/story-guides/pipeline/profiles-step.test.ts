import { laterNames } from './lines-step';
import { mergeNames } from './merge-step';
import {
  PROFILES_SCHEMA,
  PROFILES_SYSTEM,
  PROFILES_REWRITE_SYSTEM,
  profileProblem,
  profilesAiStep,
  profilesRequest,
  profilesRows,
  profilesState,
  readProfilesAnswer,
  unitText,
  writeProfiles,
} from './profiles-step';
import { applyReview, reviewGroups } from './review-step';
import { fakeStepContext, syntheticNames, syntheticText } from './step-context.testing';
import type { StoryProfilesResult } from './story-guide.types';

/** The cabman is Jeff until chapter 3 shows he is Jefferson Hope. */
function cabman() {
  const text = syntheticText([
    ['Jeff drove the cab. Holmes watched Jeff.'],
    ['Jefferson Hope sat in the cell. Mr. Holmes smiled on Baker Street.'],
    ['Jeff was Jefferson Hope, he told Holmes.'],
  ]);
  const names = syntheticNames(text, {
    c1p1: [
      ['Jeff', [], 'character', 'A cab driver'],
      ['Holmes', [], 'character', 'A detective'],
    ],
    c2p1: [
      ['Jefferson Hope', [], 'character', 'A prisoner'],
      ['Mr. Holmes', ['Holmes'], 'character', 'a detective'],
      ['Baker Street', [], 'place', 'A street'],
    ],
    c3p1: [
      ['Jefferson Hope', ['Jeff'], 'character', 'A confessed killer'],
      ['Holmes', [], 'character', 'The one who caught him'],
    ],
  });
  const merge = mergeNames(text.passages, names);
  const id = (name: string) => merge.entities.find((entity) => entity.name === name)!.id;
  const review = applyReview(reviewGroups([{ ids: [id('Jeff'), id('Jefferson Hope')], from: 3 }], merge, text), merge, text);
  return {
    text,
    merge,
    review,
    id,
    rows: (index: number, state = new Map<number, string>()) => profilesRows(index, text, merge, review, state),
  };
}

const reply = (profiles: Record<string, string>) =>
  JSON.stringify({ profiles: Object.entries(profiles).map(([name, profile]) => ({ name, profile })) });

describe('profilesRows', () => {
  it('sends the characters present with the names met so far, members apart until their join', () => {
    const { rows, id } = cabman();
    expect(rows(0)).toEqual([
      { entity: id('Holmes'), name: 'Holmes', aliases: [], current: null, joined: [] },
      { entity: id('Jeff'), name: 'Jeff', aliases: [], current: null, joined: [] },
    ]);
    expect(rows(1, new Map([[id('Holmes'), 'A detective who watches the cab driver.']]))).toEqual([
      { entity: id('Holmes'), name: 'Holmes', aliases: ['Mr. Holmes'], current: 'A detective who watches the cab driver.', joined: [] },
      { entity: id('Jefferson Hope'), name: 'Jefferson Hope', aliases: [], current: null, joined: [] },
    ]);
    expect(rows(2).find((row) => row.entity === id('Jefferson Hope'))!.aliases).toEqual(['Jeff']);
  });

  it("brings a member's profile into its entity's row in the unit of its join only", () => {
    const { rows, id } = cabman();
    const state = new Map([
      [id('Jeff'), 'A cab driver whom Holmes watches.'],
      [id('Jefferson Hope'), 'A prisoner in a cell.'],
    ]);
    expect(rows(2, state).find((row) => row.entity === id('Jefferson Hope'))).toMatchObject({
      current: 'A prisoner in a cell.',
      joined: [{ name: 'Jeff', profile: 'A cab driver whom Holmes watches.' }],
    });
    expect(rows(1, state).find((row) => row.entity === id('Jefferson Hope'))!.joined).toEqual([]);
  });
});

describe('unitText', () => {
  it("is the unit's passages in order", () => {
    const text = syntheticText([['a', 'b', 'c'], ['d']], { 1: [2, 1] });
    expect(unitText(0, text)).toBe(`${text.passages[0].text}\n\n${text.passages[1].text}`);
    expect(unitText(2, text)).toBe(text.passages[3].text);
  });
});

describe('profiles prompt', () => {
  it('sends the chapter, then each character with its other names, current profile and joined entries, with the schema', () => {
    expect(
      profilesRequest('Jeff drove the cab.', [
        { entity: 1, name: 'Holmes', aliases: ['Mr. Holmes'], current: 'A detective.', joined: [] },
        { entity: 2, name: 'Jefferson Hope', aliases: ['Jeff'], current: null, joined: [{ name: 'Jeff', profile: 'A cab driver.' }] },
      ]),
    ).toEqual({
      system: PROFILES_SYSTEM,
      user:
        '<chapter>\nJeff drove the cab.\n</chapter>\n\nCharacters:\n' +
        '- Holmes | also: Mr. Holmes | current: A detective.\n' +
        '- Jefferson Hope | also: Jeff | current: none | kept apart until now as Jeff: A cab driver.',
      schema: PROFILES_SCHEMA,
      maxOutputTokens: 12000,
      effort: 'medium',
    });
  });

  it('reads the profiles list, skipping malformed items and stray closing braces, and refuses an answer without one', () => {
    expect(
      readProfilesAnswer({
        profiles: [{ name: 'Mr. Holmes', profile: 'A detective.' }, { name: 'Jeff' }, null, { name: 'Ann', profile: 'A cook. }' }],
      }),
    ).toEqual(
      new Map([
        ['mr holmes', 'A detective.'],
        ['ann', 'A cook.'],
      ]),
    );
    expect(readProfilesAnswer({ profiles: { Holmes: 'A detective.' } })).toBeNull();
  });
});

describe('profile checks', () => {
  const none = { later: [], visible: [] };

  it('fails a profile naming an entity first anchored after its unit', () => {
    const { text, merge } = cabman();
    expect(profileProblem('A cab driver. He is really Jefferson Hope.', laterNames(0, text, merge))).toEqual({
      reason: 'names-later-entity',
      detail: 'names Jefferson Hope, who has not been introduced yet',
    });
    expect(profileProblem('A cab driver whom Holmes watches.', laterNames(0, text, merge))).toBeNull();
  });

  it('fails a profile over a hundred words and one that says the narrator, but lets "or" through', () => {
    expect(profileProblem(Array.from({ length: 101 }, () => 'word').join(' '), none)?.reason).toBe('too-long');
    expect(profileProblem(Array.from({ length: 100 }, () => 'word').join(' '), none)).toBeNull();
    expect(profileProblem('The narrator’s brother.', none)?.reason).toBe('narrator');
    expect(profileProblem('He can neither read or write.', none)).toBeNull();
  });
});

describe('writeProfiles', () => {
  const { rows, text, merge, id } = cabman();
  const through = { chapter: 1, part: null };
  const later = laterNames(0, text, merge);

  it('keeps only changed profiles and gives a failing one a rewrite without the chapter', async () => {
    const current = rows(0, new Map([[id('Holmes'), 'A detective.']]));
    const ctx = fakeStepContext({}, (_, index) =>
      index === 0
        ? reply({ Holmes: 'A detective.', Jeff: 'A cab driver who is really Jefferson Hope.' })
        : reply({ jeff: 'A cab driver whom Holmes watches.' }),
    );
    const result = await writeProfiles(ctx, through, 'Jeff drove the cab. Holmes watched Jeff.', current, later);
    expect(result).toEqual({
      through,
      profiles: [{ entity: id('Jeff'), name: 'Jeff', text: 'A cab driver whom Holmes watches.' }],
      dropped: [],
      rewritten: 1,
    });
    expect(ctx.requests).toHaveLength(2);
    expect(ctx.requests[1]).toMatchObject({
      system: PROFILES_REWRITE_SYSTEM,
      user: '- Jeff: "A cab driver who is really Jefferson Hope." (names Jefferson Hope, who has not been introduced yet)',
      schema: PROFILES_SCHEMA,
    });
  });

  it("keeps a joined entry's profile for a character with none that the answer leaves out", async () => {
    const result = await writeProfiles(
      fakeStepContext({}, () => reply({})),
      { chapter: 3, part: null },
      'Jeff was Jefferson Hope.',
      rows(2, new Map([[id('Jeff'), 'A cab driver whom Holmes watches.']])),
      laterNames(2, text, merge),
    );
    expect(result.profiles).toEqual([{ entity: id('Jefferson Hope'), name: 'Jefferson Hope', text: 'A cab driver whom Holmes watches.' }]);
  });

  it('drops a profile that fails again, keeping the previous one', async () => {
    const answer = reply({ Jeff: 'A cab driver who is really Jefferson Hope.' });
    const result = await writeProfiles(
      fakeStepContext({}, () => answer),
      through,
      'Jeff drove the cab.',
      rows(0),
      later,
    );
    expect(result.profiles).toEqual([]);
    expect(result.dropped).toEqual([
      { entity: id('Jeff'), name: 'Jeff', text: 'A cab driver who is really Jefferson Hope.', reason: 'names-later-entity' },
    ]);
  });

  it('asks nothing for a unit with no characters', async () => {
    const ctx = fakeStepContext({}, () => reply({}));
    expect(await writeProfiles(ctx, through, '', [], later)).toEqual({ through, profiles: [], dropped: [], rewritten: 0 });
    expect(ctx.requests).toHaveLength(0);
  });
});

describe('profilesState', () => {
  it('replays the units in order', () => {
    const results: StoryProfilesResult[] = [
      { through: { chapter: 1, part: null }, profiles: [{ entity: 1, name: 'Ann', text: 'First.' }], dropped: [], rewritten: 0 },
      { through: { chapter: 2, part: null }, profiles: [{ entity: 1, name: 'Ann', text: 'Second.' }], dropped: [], rewritten: 0 },
    ];
    expect(profilesState(results)).toEqual(new Map([[1, 'Second.']]));
  });
});

describe('profilesAiStep', () => {
  it('chains the lines units in order on the fast slot after the review', () => {
    const step = profilesAiStep();
    expect(step).toMatchObject({ id: 'profiles', slot: 'fast', sequential: true, dependsOn: ['text', 'merge', 'review'] });
  });
});
