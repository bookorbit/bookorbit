import { createHash } from 'crypto';

import { AiError } from '../../ai-jobs/ai-jobs.ports';
import { parseJsonReply } from './json-reply';
import { labReplay } from './lab-replay.testing';
import {
  NAMES_SHAPE,
  NAMES_SYSTEM,
  bookFilter,
  checkNames,
  dropRoleNames,
  entryKind,
  nameCandidates,
  namesAiStep,
  namesRequest,
  readNamesAnswer,
  toldInFirstPerson,
  validateEntries,
  type RawNameEntry,
} from './names-step';
import { fakeStepContext, syntheticText } from './step-context.testing';

const entry = (name: string, aliases: string[] = [], kind = 'character'): RawNameEntry => ({ name, aliases, kind, what: '' });
const book = { title: 'The Long Road', authors: ['Ann Writer'] };

describe('names prompt', () => {
  it('is the pinned prompt: a change to it bumps the step version', () => {
    expect(
      createHash('sha256')
        .update(NAMES_SYSTEM + NAMES_SHAPE)
        .digest('hex')
        .slice(0, 16),
    ).toBe('8153e4371b0b7d66');
  });

  it('keeps institutions out of the characters and a narrator in one entry', () => {
    expect(NAMES_SYSTEM).toContain('Never a bank, school, shop, company or other institution, and never a place.');
    expect(NAMES_SYSTEM).toContain('including an institution such as a bank, school, ministry or company');
    expect(NAMES_SYSTEM).toContain('The narrator is one entry: when the chapter calls them by a full name, a nickname and a pet name');
  });

  it('sends the book, the chapter and its checklist at medium effort', () => {
    const request = namesRequest({ title: 'The Long Road', authors: ['Ann Writer', 'Bo Other'] }, 'Mary met Tom.');
    expect(request).toMatchObject({ system: NAMES_SYSTEM, maxOutputTokens: 8000, effort: 'medium' });
    expect(request.user).toBe('Book: The Long Road, by Ann Writer and Bo Other\n\nChapter:\nMary met Tom.\n\nChecklist:\nTom' + NAMES_SHAPE);
    expect(namesRequest({ title: 'Untitled', authors: [] }, 'x').user.startsWith('Book: Untitled\n\n')).toBe(true);
  });
});

describe('nameCandidates', () => {
  it('keeps a name seen mid-sentence, and one that opens sentences twice when it is no everyday word', () => {
    const text = 'Holmes laughed. Then I saw Watson.\nHolmes ran. Then we left.';
    expect(nameCandidates(text)).toEqual(expect.arrayContaining(['Holmes', 'Watson']));
    expect(nameCandidates(text)).not.toContain('Then');
    expect(nameCandidates(text)).not.toContain('I');
  });

  it('lists the tail of a run that opens with an everyday word', () => {
    const text = 'The Strand was busy.\nThe Strand ran down to the river.';
    expect(nameCandidates(text)).not.toContain('The Strand');
    expect(nameCandidates(text)).toContain('Strand');
  });
});

describe('toldInFirstPerson', () => {
  it('counts pronouns outside dialogue only', () => {
    expect(toldInFirstPerson('I walked home. My feet hurt, and the rain soaked me. He waved.')).toBe(true);
    expect(toldInFirstPerson('He walked home. "I am tired, my dear," she told me him. His feet hurt.')).toBe(false);
  });
});

describe('readNamesAnswer', () => {
  it('needs a list of entries and makes every field a string', () => {
    expect(readNamesAnswer({ narrator: 'Ann' })).toBeNull();
    expect(readNamesAnswer({ narrator: 3, entries: [{ name: 'Ann', aliases: ['A', 2], kind: 'character' }, 'junk'] })).toEqual({
      narrator: null,
      entries: [{ name: 'Ann', aliases: ['A'], kind: 'character', what: '' }],
    });
  });
});

describe('validateEntries', () => {
  const text = 'Sherlock Holmes and Mrs. Hudson spoke. Holmes nodded. Doctor Watson, or John, smiled at Mr. Holmes.';

  it('drops aliases the passage does not write, lowercase ones and role words', () => {
    const [checked] = validateEntries([entry('Sherlock Holmes', ['Holmes', 'Sherlock', 'the detective', 'Doctor', 'Shirley'])], text);
    expect(checked.aliases).toEqual(['Holmes', 'Sherlock']);
  });

  it('drops a Mr. or Mrs. form of another surname', () => {
    const [checked] = validateEntries([entry('Sherlock Holmes', ['Mrs. Hudson', 'Mr. Holmes'])], text);
    expect(checked.aliases).toEqual(['Mr. Holmes']);
  });

  it('takes the longest alias as the name when the name is not in the passage', () => {
    expect(validateEntries([entry('John H. Watson', ['Doctor Watson', 'John'])], text)).toEqual([entry('Doctor Watson', ['John'])]);
    expect(validateEntries([entry('Moriarty', ['Professor'])], text)).toEqual([]);
  });

  it('folds an entry that is an earlier alias into it, and gives a shared alias to neither', () => {
    const checked = validateEntries([entry('Sherlock Holmes', ['Holmes']), entry('Holmes', ['Mr. Holmes'])], text);
    expect(checked).toEqual([entry('Sherlock Holmes', ['Holmes', 'Mr. Holmes'])]);
    const shared = validateEntries([entry('Sherlock Holmes', ['Holmes']), entry('Mr. Holmes', ['Holmes'])], text);
    expect(shared.map((item) => item.aliases)).toEqual([[], []]);
  });
});

describe('bookFilter', () => {
  it('drops the author, the whole title, days and months, and kind none', () => {
    const kept = bookFilter(
      [
        entry('Ann Writer'),
        entry('Writer'),
        entry('The Long Road', [], 'object'),
        entry('Monday', [], 'event'),
        entry('Thing', [], 'none'),
        entry('Long Road'),
      ],
      book,
    );
    expect(kept.map((item) => item.name)).toEqual(['Long Road']);
  });
});

describe('dropRoleNames', () => {
  it('names an entry by its real alias, or drops it', () => {
    expect(dropRoleNames([entry('Mom', ['Mother', 'Jane Doe']), entry('Uncle'), entry('Uncle Vernon')])).toEqual([
      entry('Jane Doe'),
      entry('Uncle Vernon'),
    ]);
  });
});

describe('entryKind', () => {
  it('keeps the six kinds and files anything else as an idea', () => {
    expect(entryKind(' Place ')).toBe('place');
    expect(entryKind('animal')).toBe('idea');
  });
});

describe('checkNames', () => {
  const [passage] = syntheticText([['I met Mary Ann at the inn. My hands shook; I said “Mary” and she smiled at me.']]).passages;

  it('records where each kept name is, exactly as written', () => {
    const result = checkNames({ narrator: 'Tom', entries: [entry('Mary Ann', ['Mary']), entry('Tom')] }, passage, book);
    expect(result.entries.map((item) => item.name)).toEqual(['Mary Ann']);
    for (const [name, at] of Object.entries(result.entries[0].at)) {
      expect(at.passage).toBe('c1p1');
      expect(passage.text.slice(at.offset, at.offset + at.text.length)).toBe(at.text);
      expect(at.text).toBe(name);
    }
  });

  it('keeps a narrator only in first-person narration, and only one of the entries', () => {
    expect(checkNames({ narrator: 'Mary', entries: [entry('Mary Ann', ['Mary'])] }, passage, book).narrator).toBe('Mary Ann');
    expect(checkNames({ narrator: 'Tom', entries: [entry('Mary Ann', ['Mary'])] }, passage, book).narrator).toBeNull();
    const [told] = syntheticText([['Mary Ann walked home. She was tired, and her feet hurt.']]).passages;
    expect(checkNames({ narrator: 'Mary Ann', entries: [entry('Mary Ann')] }, told, book).narrator).toBeNull();
  });
});

describe('namesAiStep', () => {
  const text = syntheticText([['Mary met Tom at the inn. Tom smiled.', 'Then Mary left.']]);
  const reply = JSON.stringify({ narrator: null, entries: [{ name: 'Mary', aliases: [], kind: 'character', what: 'a guest' }] });

  it('runs each passage on the fast slot after text', () => {
    const step = namesAiStep();
    expect(step).toMatchObject({ id: 'names', version: 2, slot: 'fast', dependsOn: ['text'] });
    expect(step.sequential).toBeFalsy();
    expect(step.units(fakeStepContext({ text: { book: text } }))).toEqual([{ id: 'c1p1' }, { id: 'c1p2' }]);
  });

  it('fingerprints the prompt and the passage', () => {
    const step = namesAiStep();
    const ctx = fakeStepContext({ text: { book: text } });
    const changed = syntheticText([['Mary met Tom at the inn. Tom grinned.', 'Then Mary left.']]);
    expect(step.fingerprint(ctx, { id: 'c1p1' })).toBe(step.fingerprint(fakeStepContext({ text: { book: text } }), { id: 'c1p1' }));
    expect(step.fingerprint(ctx, { id: 'c1p1' })).not.toBe(step.fingerprint(fakeStepContext({ text: { book: changed } }), { id: 'c1p1' }));
    expect(step.fingerprint(ctx, { id: 'c1p2' })).toBe(step.fingerprint(fakeStepContext({ text: { book: changed } }), { id: 'c1p2' }));
  });

  it('checks the reply', async () => {
    const ctx = fakeStepContext({ text: { book: text } }, () => reply);
    const result = await namesAiStep().run(ctx, { id: 'c1p1' });
    expect(result).toMatchObject({ passage: 'c1p1', chapter: 1, part: 1, narrator: null, entries: [{ name: 'Mary', kind: 'character' }] });
    expect(ctx.requests[0].effort).toBe('medium');
  });

  it('leaves a passage out after two unreadable replies', async () => {
    const ctx = fakeStepContext({ text: { book: text } }, () => 'Sorry, no.');
    await expect(namesAiStep().run(ctx, { id: 'c1p1' })).rejects.toMatchObject({ name: 'AiUnitSkipped', reason: 'invalid-json' });
    expect(ctx.requests).toHaveLength(2);
  });

  it('splits a passage whose reply is cut short and joins the halves', async () => {
    const long = syntheticText([['Mary met Tom. '.repeat(100) + 'Ann saw Mary. '.repeat(100)]]);
    const ctx = fakeStepContext({ text: { book: long } }, (request, index) => {
      if (index === 0) return new AiError('too-long');
      const name = request.user.includes('Ann saw') ? 'Ann' : 'Tom';
      return JSON.stringify({ narrator: null, entries: [{ name, aliases: [], kind: 'character', what: '' }] });
    });
    const result = await namesAiStep().run(ctx, { id: 'c1p1' });
    expect(ctx.requests).toHaveLength(3);
    expect((result as { entries: { name: string }[] }).entries.map((item) => item.name)).toEqual(['Tom', 'Ann']);
  });
});

describe('the saved public-domain replies', () => {
  /**
   * The lab's saved replies through the server's checks, on the server's text. On the lab's own text
   * every entry matches; here the text differs (the lab's keeps Gutenberg's hard line wraps and cuts
   * passages a little differently), so a name near a passage edge can sit in the neighbouring passage.
   */
  it('keeps the entries the lab kept', async () => {
    const replay = await labReplay();
    const meta = { title: replay.lab.book.title, authors: [replay.lab.book.author] };
    const key = (item: { name: string; kind: string }) => `${item.name}|${item.kind}`;
    const aliases = (item: { aliases: string[] }) => [...item.aliases].sort().join('|');
    let labEntries = 0;
    let inServerText = 0;
    let matched = 0;
    let sameAliases = 0;
    let extra = 0;
    let narrators = 0;
    for (const saved of Object.values(replay.lab.names)) {
      const passage = replay.passageOf(saved.unit);
      const answer = readNamesAnswer(parseJsonReply(saved.raw) ?? {});
      expect(answer).not.toBeNull();
      const result = checkNames(answer!, passage, meta);
      const mine = new Map(result.entries.map((item) => [key(item), item]));
      const theirs = new Set(saved.entries.map(key));
      labEntries += saved.entries.length;
      inServerText += saved.entries.filter((item) => passage.text.replace(/’/g, "'").includes(item.name.replace(/’/g, "'"))).length;
      for (const item of saved.entries) {
        const found = mine.get(key(item));
        if (!found) continue;
        matched++;
        if (aliases(found) === aliases(item)) sameAliases++;
      }
      extra += [...mine.keys()].filter((item) => !theirs.has(item)).length;
      if (result.narrator === saved.narrator) narrators++;
    }
    expect({ passages: Object.keys(replay.lab.names).length, labEntries, inServerText, matched, sameAliases, extra, narrators }).toEqual({
      passages: 35,
      labEntries: 496,
      inServerText: 487,
      matched: 486,
      sameAliases: 484,
      extra: 17,
      narrators: 35,
    });
    expect(matched / inServerText).toBeGreaterThanOrEqual(0.98);
  });
});
