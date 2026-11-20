import { flattenSectionText } from '../text/section-text';
import { flattenWithOffsets, StoryAnchors } from './anchors';
import type { StoryChapter, TextStepResult } from './text-step';
import { chapterPassages, storyLines } from './text-step';

function chapter(number: number, s: number, raw: string, blocks: number[], parts?: { part: number; start: number; end: number }[]): StoryChapter {
  return {
    number,
    s,
    title: null,
    start: 0,
    end: raw.length,
    lines: storyLines(raw, blocks, 0, raw.length),
    parts: parts ?? [{ part: 1, start: 0, end: raw.length }],
  };
}

function textOf(chapters: StoryChapter[]): TextStepResult {
  return { key: 'k', chapters, passages: chapters.flatMap(chapterPassages) };
}

describe('flattenWithOffsets', () => {
  it.each([
    '  Lead and trail  ',
    'a \u200B b',
    '\uFEFF x\u00A0\u00A0y',
    'soft\u00ADhyphen and\u2060joiner',
    '\u{1F600} emoji\n\tafter',
    '\u200B',
    '',
  ])('flattens %j exactly as the reader does, each character mapped back', (raw) => {
    const { text, at } = flattenWithOffsets(raw);
    expect(text).toBe(flattenSectionText(raw));
    expect(at).toHaveLength(text.length);
    for (let index = 0; index < text.length; index++) {
      if (text[index] === ' ') expect(raw[at[index]]).toMatch(/\s/);
      else expect(raw[at[index]]).toBe(text[index]);
    }
  });
});

describe('StoryAnchors', () => {
  const heading = 'CHAPTER I.';
  const body = 'It was Lord\u00A0 Leverance who\u00AD spoke  first, and then everyone in the great hall listened to him for a long while.';
  const raw = heading + '\n' + body;
  const text = textOf([chapter(1, 4, raw, [0, heading.length + 1])]);
  const anchors = new StoryAnchors(text, new Map([[4, raw]]));
  const passage = text.passages[0];

  it('maps a span to the raw offset, with the quote exactly as in the book', () => {
    const offset = passage.text.indexOf('Lord Leverance');
    const at = anchors.span({ passage: passage.id, offset, text: 'Lord Leverance' });
    expect(at).toEqual({ s: 4, o: raw.indexOf('Lord'), q: 'Lord\u00A0 Leverance' });
  });

  it('keeps an invisible character inside the quote, as the raw text has it', () => {
    const offset = passage.text.indexOf('who spoke');
    expect(anchors.span({ passage: passage.id, offset, text: 'who spoke' })).toEqual({ s: 4, o: raw.indexOf('who'), q: 'who\u00AD spoke' });
  });

  it('cuts a quote to twelve words and keeps it inside its block', () => {
    const at = anchors.span({ passage: passage.id, offset: 0, text: passage.text });
    expect(at).toEqual({ s: 4, o: 0, q: 'CHAPTER I.' });
    const long = anchors.span({
      passage: passage.id,
      offset: passage.text.indexOf('It was'),
      text: passage.text.slice(passage.text.indexOf('It was')),
    });
    expect(long && 'q' in long && flattenSectionText(long.q).split(' ')).toHaveLength(12);
  });

  it('refuses a span that is not in its passage', () => {
    expect(anchors.span({ passage: passage.id, offset: 3, text: 'Leverance' })).toBeNull();
    expect(anchors.span({ passage: 'c9p1', offset: 0, text: 'x' })).toBeNull();
  });

  it('stamps a chapter end, and a part end with the last words of the part', () => {
    expect(anchors.through({ chapter: 1, part: null })).toEqual({ s: 4, end: true });
    const first = 'One two three four five six seven eight nine ten eleven twelve thirteen.';
    const second = 'The next part begins here.';
    const long = first + second;
    const parts = [
      { part: 1, start: 0, end: first.length },
      { part: 2, start: first.length, end: long.length },
    ];
    const split = new StoryAnchors(textOf([chapter(2, 6, long, [0, first.length], parts)]), new Map([[6, long]]));
    expect(split.through({ chapter: 2, part: 1 })).toEqual({
      s: 6,
      o: first.indexOf('two'),
      q: 'two three four five six seven eight nine ten eleven twelve thirteen.',
    });
    expect(split.through({ chapter: 2, part: 2 })).toEqual({ s: 6, end: true });
  });
});
