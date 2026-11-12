import { createHash } from 'crypto';

import { labReplay } from './lab-replay.testing';
import {
  LINES_SYSTEM,
  isPlaceholder,
  laterNames,
  lineLeaks,
  lineProblem,
  linesAiStep,
  linesRequest,
  linesRows,
  linesState,
  linesUnits,
  writeLines,
  type LinesRow,
} from './lines-step';
import { mergeNames } from './merge-step';
import { nameKey } from './name-text';
import { applyReview, reviewGroups } from './review-step';
import { fakeStepContext, syntheticNames, syntheticText } from './step-context.testing';
import type { StoryLinesResult } from './story-guide.types';

/** The cabman is Jeff until chapter 3 shows he is Jefferson Hope. */
function cabman() {
  const text = syntheticText([
    ['Jeff drove the cab. Holmes watched Jeff.'],
    ['Jefferson Hope sat in the cell. Holmes smiled on Baker Street.'],
    ['Jeff was Jefferson Hope, he told Holmes.'],
  ]);
  const names = syntheticNames(text, {
    c1p1: [
      ['Jeff', [], 'character', 'A cab driver'],
      ['Holmes', [], 'character', 'A detective'],
    ],
    c2p1: [
      ['Jefferson Hope', [], 'character', 'A prisoner'],
      ['Holmes', [], 'character', 'a detective'],
      ['Baker Street', [], 'place', 'A street'],
    ],
    c3p1: [
      ['Jefferson Hope', [], 'character', 'A confessed killer'],
      ['Holmes', [], 'character', 'The one who caught him'],
    ],
  });
  const merge = mergeNames(text.passages, names);
  const id = (name: string) => merge.entities.find((entity) => entity.name === name)!.id;
  const review = applyReview(reviewGroups([{ ids: [id('Jeff'), id('Jefferson Hope')], from: 3 }], merge, text), merge, text);
  return { text, merge, review, id, rows: (index: number, state = new Map<number, string>()) => linesRows(index, text, merge, review, state) };
}

const row = (entity: number, name: string, current: string | null = null): LinesRow => ({ entity, name, current, notes: [] });
const reply = (lines: Record<string, string>) => JSON.stringify({ lines });

describe('lines prompt', () => {
  it('is the reference prompt', () => {
    expect(createHash('sha256').update(LINES_SYSTEM).digest('hex').slice(0, 16)).toBe('10588cd16a5c3374');
  });

  it('sends each character with its line and notes at medium effort', () => {
    expect(
      linesRequest([{ entity: 1, name: 'Holmes', current: 'Detective', notes: ['A detective', 'new: Lives on Baker Street'] }, row(2, 'Jeff')]),
    ).toEqual({
      system: LINES_SYSTEM,
      user: '- Holmes | current: Detective | notes: A detective; new: Lives on Baker Street\n- Jeff | current: none | notes: ',
      maxOutputTokens: 8000,
      effort: 'medium',
    });
  });
});

describe('linesUnits', () => {
  it('is one unit per chapter, or per part of a long one', () => {
    const text = syntheticText([['a', 'b', 'c'], ['d']], { 1: [2, 1] });
    expect(linesUnits(text)).toEqual({
      units: [
        { id: 'c1p1', index: 0, through: { chapter: 1, part: 1 } },
        { id: 'c1p2', index: 1, through: { chapter: 1, part: 2 } },
        { id: 'c2', index: 2, through: { chapter: 2, part: null } },
      ],
      unitOf: new Map([
        ['c1p1', 0],
        ['c1p2', 0],
        ['c1p3', 1],
        ['c2p1', 2],
      ]),
    });
  });
});

describe('linesRows', () => {
  it('sends the characters present, members apart until their join', () => {
    const { rows, id } = cabman();
    expect(rows(0)).toEqual([
      { entity: id('Holmes'), name: 'Holmes', current: null, notes: ['new: A detective'] },
      { entity: id('Jeff'), name: 'Jeff', current: null, notes: ['new: A cab driver'] },
    ]);
    expect(rows(1, new Map([[id('Holmes'), 'Detective']]))).toEqual([
      { entity: id('Holmes'), name: 'Holmes', current: 'Detective', notes: ['A detective'] },
      { entity: id('Jefferson Hope'), name: 'Jefferson Hope', current: null, notes: ['new: A prisoner'] },
    ]);
    expect(rows(2).find((item) => item.entity === id('Jefferson Hope'))).toEqual({
      entity: id('Jefferson Hope'),
      name: 'Jefferson Hope',
      current: null,
      notes: ['A prisoner', 'new: A cab driver', 'new: A confessed killer'],
    });
    expect(rows(2).some((item) => item.entity === id('Jeff'))).toBe(false);
  });

  it('keeps the first six notes and the last eight of a long list', () => {
    const passages = Array.from({ length: 20 }, (_, index) => `Ann came ${index}.`);
    const text = syntheticText([passages]);
    const names = syntheticNames(
      text,
      Object.fromEntries(passages.map((_, index) => [`c1p${index + 1}`, [['Ann', [], 'character', `Note ${index}`]]])),
    );
    const merge = mergeNames(text.passages, names);
    const [only] = linesRows(0, text, merge, applyReview([], merge, text), new Map());
    expect(only.notes).toEqual([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19].map((index) => `new: Note ${index}`));
  });
});

describe('line checks', () => {
  it('fails a line naming an entity first anchored after its unit, but not a name inside one already met', () => {
    const { text, merge } = cabman();
    const early = laterNames(0, text, merge);
    expect(early.later.map((name) => name.text)).toEqual(['Jefferson Hope', 'Baker Street']);
    expect(lineProblem('Cab driver who knows Jefferson Hope', early)).toEqual({
      reason: 'names-later-entity',
      detail: 'names Jefferson Hope, who the notes have not introduced yet',
    });
    expect(lineProblem('Detective of Baker Street’s fame', early)?.reason).toBe('names-later-entity');
    expect(lineProblem('Cab driver', early)).toBeNull();
    expect(laterNames(1, text, merge).later).toEqual([]);

    const met = syntheticText([['John Ferrier came.'], ['John waved.']]);
    const metMerge = mergeNames(met.passages, syntheticNames(met, { c1p1: [['John Ferrier']], c2p1: [['John', [], 'character']] }));
    const names = laterNames(0, met, metMerge);
    expect(lineProblem('Daughter of John Ferrier', names)).toBeNull();
    expect(lineProblem('Daughter of John', names)?.reason).toBe('names-later-entity');
  });

  it('leaves out names made only of titles, role words or numbers', () => {
    const text = syntheticText([['Ann came.'], ['The Doctor and Number 4 came.']]);
    const merge = mergeNames(text.passages, syntheticNames(text, { c1p1: [['Ann']], c2p1: [['Doctor'], ['4', [], 'idea']] }));
    expect(laterNames(0, text, merge).later).toEqual([]);
  });

  it('fails a line over twelve words, one that hedges, and one that says the narrator', () => {
    const none = { later: [], visible: [] };
    expect(lineProblem('One two three four five six seven eight nine ten eleven twelve thirteen', none)?.reason).toBe('too-long');
    expect(lineProblem('One two three four five six seven eight nine ten eleven twelve', none)).toBeNull();
    expect(lineProblem('His sister or cousin', none)?.reason).toBe('hedged');
    expect(lineProblem('Oregon farmer', none)).toBeNull();
    expect(lineProblem('Friend of the narrator', none)?.reason).toBe('narrator');
    expect(isPlaceholder('None.')).toBe(true);
    expect(isPlaceholder('"n/a"')).toBe(true);
    expect(isPlaceholder('Nonetheless kind')).toBe(false);
  });
});

describe('writeLines', () => {
  const { rows, text, merge, id } = cabman();
  const through = { chapter: 1, part: null };
  const later = laterNames(0, text, merge);

  it('gives a failing line one rewrite and keeps the rewrite when it passes', async () => {
    const ctx = fakeStepContext({}, (_, index) =>
      index === 0 ? reply({ Jeff: 'Cab driver who knows Jefferson Hope', Holmes: 'Consulting detective' }) : reply({ jeff: 'Cab driver' }),
    );
    const result = await writeLines(ctx, through, rows(0), later);
    expect(result).toEqual({
      through,
      lines: [
        { entity: id('Holmes'), name: 'Holmes', text: 'Consulting detective' },
        { entity: id('Jeff'), name: 'Jeff', text: 'Cab driver' },
      ],
      dropped: [],
      rewritten: 1,
    });
    expect(ctx.requests).toHaveLength(2);
    expect(ctx.requests[1].effort).toBe('medium');
    expect(ctx.requests[1].user).toBe(
      '- Jeff | current: none | notes: new: A cab driver\n\nThese lines broke a rule. Write each again, following every rule above:\n' +
        '- Jeff: "Cab driver who knows Jefferson Hope" (names Jefferson Hope, who the notes have not introduced yet)',
    );
  });

  it('drops a line that fails again, keeping the previous one', async () => {
    const answer = reply({ Jeff: 'Cab driver who knows Jefferson Hope' });
    const result = await writeLines(
      fakeStepContext({}, () => answer),
      through,
      rows(0),
      later,
    );
    expect(result.lines).toEqual([]);
    expect(result.dropped).toEqual([{ entity: id('Jeff'), name: 'Jeff', text: 'Cab driver who knows Jefferson Hope', reason: 'names-later-entity' }]);

    const unreadable = await writeLines(
      fakeStepContext({}, (_, index) => (index === 0 ? answer : 'no')),
      through,
      rows(0),
      later,
    );
    expect(unreadable.dropped).toMatchObject([{ text: 'Cab driver who knows Jefferson Hope', reason: 'names-later-entity' }]);
  });

  it('records only changed lines, and skips placeholders and characters it was not sent', async () => {
    const state = new Map([[id('Holmes'), 'Consulting detective']]);
    const ctx = fakeStepContext({}, () => reply({ Holmes: 'Consulting detective', Jeff: 'none', Lestrade: 'Inspector' }));
    expect(await writeLines(ctx, through, rows(0, state), later)).toEqual({ through, lines: [], dropped: [], rewritten: 0 });
    expect(ctx.requests).toHaveLength(1);
  });

  it('asks nothing when no character is present, and leaves the unit out after two unreadable answers', async () => {
    const quiet = fakeStepContext({});
    expect(await writeLines(quiet, through, [], later)).toEqual({ through, lines: [], dropped: [], rewritten: 0 });
    expect(quiet.requests).toHaveLength(0);
    await expect(
      writeLines(
        fakeStepContext({}, () => '{"names": {}}'),
        through,
        rows(0),
        later,
      ),
    ).rejects.toMatchObject({ reason: 'invalid-json' });
  });
});

describe('linesAiStep', () => {
  it('runs the units in order, each reading the lines before it', async () => {
    const { text, merge, review, id } = cabman();
    const first: StoryLinesResult = {
      through: { chapter: 1, part: null },
      lines: [{ entity: id('Holmes'), name: 'Holmes', text: 'Detective' }],
      dropped: [],
      rewritten: 0,
    };
    const results = (lines: Record<string, unknown>) => ({ text: { book: text }, merge: { book: merge }, review: { cast: review }, lines });
    const ctx = fakeStepContext(results({ c1: first }), () => reply({ Holmes: 'Consulting detective' }));
    const step = linesAiStep();
    expect(step).toMatchObject({ id: 'lines', version: 1, slot: 'fast', sequential: true, dependsOn: ['text', 'merge', 'review'] });
    expect(step.units(ctx)).toEqual([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    expect(await step.run(ctx, { id: 'c2' })).toEqual({
      through: { chapter: 2, part: null },
      lines: [{ entity: id('Holmes'), name: 'Holmes', text: 'Consulting detective' }],
      dropped: [],
      rewritten: 0,
    });
    expect(ctx.requests[0].user.split('\n')[0]).toBe('- Holmes | current: Detective | notes: A detective');
    const other = { ...first, lines: [{ ...first.lines[0], text: 'Sleuth' }] };
    expect(step.fingerprint(ctx, { id: 'c2' })).not.toBe(step.fingerprint(fakeStepContext(results({ c1: other })), { id: 'c2' }));
    expect(step.fingerprint(ctx, { id: 'c1' })).toBe(step.fingerprint(fakeStepContext(results({ c1: other })), { id: 'c1' }));
  });
});

describe('the saved public-domain lines', () => {
  it('flags the lab lines that name an entity before its anchor', async () => {
    const replay = await labReplay();
    const { units } = linesUnits(replay.text);
    const previous = new Map<string, string>();
    let written = 0;
    const flagged: string[] = [];
    for (const saved of Object.values(replay.lab.lines).sort((a, b) => a.chapter - b.chapter)) {
      const names = laterNames(
        units.findIndex((unit) => unit.through.chapter === saved.chapter),
        replay.text,
        replay.merge,
      );
      for (const [name, line] of Object.entries(saved.lines)) {
        if (previous.get(name) === line) continue;
        previous.set(name, line);
        written++;
        const problem = lineProblem(line, names);
        if (problem) flagged.push(`${saved.chapter} ${name}: ${problem.reason}`);
      }
    }
    expect(written).toBe(111);
    expect(flagged).toEqual(['6 Wiggins: names-later-entity', '7 Enoch J. Drebber: names-later-entity']);
  });

  it('writes no line that names an entity before its anchor when the model answers with the lab’s lines', async () => {
    const replay = await labReplay();
    const { units } = linesUnits(replay.text);
    const results: StoryLinesResult[] = [];
    let rows = 0;
    for (const unit of units) {
      const saved = Object.values(replay.lab.lines).find((item) => item.chapter === unit.through.chapter)!;
      const sent = linesRows(unit.index, replay.text, replay.merge, replay.review, linesState(results));
      rows += sent.length;
      const keys = new Set(sent.map((item) => nameKey(item.name)));
      const answer = reply(Object.fromEntries(Object.entries(saved.lines).filter(([name]) => keys.has(nameKey(name)))));
      results.push(
        await writeLines(
          fakeStepContext({}, () => answer),
          unit.through,
          sent,
          laterNames(unit.index, replay.text, replay.merge),
        ),
      );
    }
    expect(lineLeaks(results, replay.text, replay.merge)).toEqual([]);
    expect({
      rows,
      written: results.reduce((sum, result) => sum + result.lines.length, 0),
      rewritten: results.reduce((sum, result) => sum + result.rewritten, 0),
      dropped: results.flatMap((result) => result.dropped.map((line) => `${result.through.chapter} ${line.name}: ${line.reason}`)),
    }).toEqual({ rows: 141, written: 107, rewritten: 2, dropped: ['6 Wiggins: names-later-entity', '7 Enoch J. Drebber: names-later-entity'] });
  });
});
