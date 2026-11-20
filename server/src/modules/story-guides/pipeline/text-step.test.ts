import { labRun, publicDomainText } from '../testing/story-guide-fixtures';
import { chapterPassages, storyLines, textAiStep, type StoryChapter } from './text-step';

describe('text step', () => {
  it('gives the public-domain book the lab pipeline chapters and passages', async () => {
    const { book, text } = await publicDomainText();
    const lab = labRun();
    expect(text.chapters).toHaveLength(14);
    expect(text.passages).toHaveLength(lab.units.length);
    expect(text.passages.map((passage) => [passage.chapter, passage.part])).toEqual(lab.units.map((unit) => [unit.chapter, unit.part]));

    for (const passage of text.passages) {
      expect(passage.text.length).toBeLessThanOrEqual(12000);
      expect(passage.text).not.toMatch(/ {2}|\n\n/);
      const raw = book.sections[passage.s].text.slice(passage.start, passage.end).replace(/\s+/g, ' ');
      expect(raw).toContain(passage.text.split('\n')[0]);
    }
    expect(text.passages[0].id).toBe('c1p1');
    expect(text.chapters.every((chapter) => chapter.parts.length === 1)).toBe(true);
  });

  it('puts each block on its own line, so a heading does not run into its paragraph', () => {
    const raw = 'CHAPTER I.\n  It was a dark night.  Rain fell.';
    expect(storyLines(raw, [0, 10], 0, raw.length)).toEqual([
      { at: 0, text: 'CHAPTER I.' },
      { at: 10, text: 'It was a dark night. Rain fell.' },
    ]);
  });

  it('cuts a long chapter into even passages at line breaks', () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ at: i * 1000, text: 'x'.repeat(999) }));
    const chapter: StoryChapter = { number: 3, s: 7, title: null, start: 0, end: 40000, lines, parts: [] };
    const passages = chapterPassages(chapter);
    expect(passages).toHaveLength(5);
    expect(passages.map((passage) => passage.id)).toEqual(['c3p1', 'c3p2', 'c3p3', 'c3p4', 'c3p5']);
    expect(passages[1].start).toBe(passages[0].end);
    expect(passages[4].end).toBe(40000);
  });
});

describe('text AiStep', () => {
  const ctx = (key: string) => ({ subject: { key, file: { id: 1 } } }) as unknown as Parameters<ReturnType<typeof textAiStep>['run']>[0];

  it('builds the chapters and passages when the text still has its key', async () => {
    const { book } = await publicDomainText();
    const { storySections, storyTextKey } = await import('../text/story-sections');
    const sections = storySections(book);
    const key = storyTextKey(book, sections, 1);
    const step = textAiStep({ read: () => Promise.resolve({ book, sections, key }) });
    const result = (await step.run(ctx(key), { id: 'book' })) as { passages: unknown[] };
    expect(result.passages).toHaveLength(35);
    expect(step.units(ctx(key) as never)).toEqual([{ id: 'book' }]);
  });

  it('fails the job when the file changed or cannot be read', async () => {
    const { book } = await publicDomainText();
    const changed = textAiStep({ read: () => Promise.resolve({ book, sections: [], key: 'other' }) });
    await expect(changed.run(ctx('key'), { id: 'book' })).rejects.toMatchObject({ reason: 'source-changed' });
    const broken = textAiStep({ read: () => Promise.reject(new Error('gone')) });
    await expect(broken.run(ctx('key'), { id: 'book' })).rejects.toMatchObject({ reason: 'unreadable' });
  });
});
