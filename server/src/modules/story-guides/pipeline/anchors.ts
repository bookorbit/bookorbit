import type { StoryGuideAnchor } from '@bookorbit/types';

import type { PassageSpan, StoryLinesThrough } from './story-guide.types';
import type { StoryChapter, StoryLine, StoryPassage, TextStepResult } from './text-step';

/** An anchor's quote is at most this many words. */
export const ANCHOR_WORDS = 12;

const INVISIBLE = new Set(['\u200B', '\u00AD', '\u2060', '\uFEFF']);
const WHITESPACE = /\s/;

/**
 * `flattenSectionText` with the raw offset of each character it keeps: whitespace runs to one space
 * (at the run's first character), then invisible characters removed, then trimmed. The steps run in
 * that order, so a removed invisible can leave two spaces side by side, as the flattening does.
 */
export function flattenWithOffsets(raw: string): { text: string; at: number[] } {
  const chars: string[] = [];
  const at: number[] = [];
  for (let index = 0; index < raw.length;) {
    if (WHITESPACE.test(raw[index])) {
      chars.push(' ');
      at.push(index);
      while (index < raw.length && WHITESPACE.test(raw[index])) index++;
      continue;
    }
    if (!INVISIBLE.has(raw[index])) {
      chars.push(raw[index]);
      at.push(index);
    }
    index++;
  }
  let from = 0;
  let to = chars.length;
  while (from < to && chars[from] === ' ') from++;
  while (to > from && chars[to - 1] === ' ') to--;
  return { text: chars.slice(from, to).join(''), at: at.slice(from, to) };
}

/** Narrows `[from, to)` of a line to whole words: no spaces at either end, and at most `words` words. */
function cutWords(text: string, from: number, to: number, words: number, keep: 'start' | 'end'): [number, number] {
  while (from < to && text[from] === ' ') from++;
  while (to > from && text[to - 1] === ' ') to--;
  if (keep === 'start') {
    let count = 0;
    for (let index = from; index < to; index++) {
      if (text[index] !== ' ' && (index === from || text[index - 1] === ' ') && ++count > words) {
        to = index;
        while (to > from && text[to - 1] === ' ') to--;
        break;
      }
    }
  } else {
    let count = 0;
    for (let index = to - 1; index >= from; index--) {
      if (text[index] !== ' ' && (index === to - 1 || text[index + 1] === ' ') && ++count > words) {
        from = index + 1;
        while (from < to && text[from] === ' ') from++;
        break;
      }
    }
  }
  return [from, to];
}

interface MappedLine {
  line: StoryLine;
  /** Where the line's block ends in the raw text: the next line's start, or the chapter's end. */
  end: number;
  map: { text: string; at: number[] } | null;
}

/**
 * Turns places in the model's input into anchors in the raw section text the reader indexes. A
 * passage's text is its lines joined with line breaks; each line is one block, flattened, and the
 * flattening's offset map takes a position in it back to the raw text.
 */
export class StoryAnchors {
  private readonly chapters = new Map<number, StoryChapter>();
  private readonly passages = new Map<string, StoryPassage>();
  private readonly lines = new Map<number, MappedLine[]>();

  constructor(
    text: TextStepResult,
    private readonly raw: ReadonlyMap<number, string>,
  ) {
    for (const chapter of text.chapters) this.chapters.set(chapter.number, chapter);
    for (const passage of text.passages) this.passages.set(passage.id, passage);
  }

  /** The anchor of a span of a passage, cut to `words` words inside its line; null when it does not map. */
  span(span: PassageSpan, words = ANCHOR_WORDS): StoryGuideAnchor | null {
    const passage = this.passages.get(span.passage);
    const chapter = passage && this.chapters.get(passage.chapter);
    if (!passage || !chapter) return null;
    if (passage.text.slice(span.offset, span.offset + span.text.length) !== span.text) return null;
    let cursor = 0;
    for (const item of this.chapterLines(chapter)) {
      if (item.line.at < passage.start || item.line.at >= passage.end) continue;
      const length = item.line.text.length;
      if (span.offset < cursor + length) {
        const from = Math.max(0, span.offset - cursor);
        const to = Math.min(length, span.offset + span.text.length - cursor);
        return this.anchor(chapter, item, from, to, words, 'start');
      }
      cursor += length + 1;
    }
    return null;
  }

  /** Where a line holds from: a chapter's end, or the last words of a part that is not its chapter's last. */
  through(through: StoryLinesThrough): StoryGuideAnchor | null {
    const chapter = this.chapters.get(through.chapter);
    if (!chapter) return null;
    if (through.part === null || through.part >= chapter.parts.length) return { s: chapter.s, end: true };
    const part = chapter.parts[through.part - 1];
    if (!part) return null;
    const last = this.chapterLines(chapter).filter((item) => item.line.at >= part.start && item.line.at < part.end && item.map);
    const item = last[last.length - 1];
    if (!item) return null;
    return this.anchor(chapter, item, 0, item.line.text.length, ANCHOR_WORDS, 'end');
  }

  private anchor(chapter: StoryChapter, item: MappedLine, from: number, to: number, words: number, keep: 'start' | 'end'): StoryGuideAnchor | null {
    const map = item.map;
    if (!map) return null;
    const [start, end] = cutWords(map.text, from, to, words, keep);
    if (end <= start) return null;
    const raw = this.raw.get(chapter.s)!;
    const o = item.line.at + map.at[start];
    return { s: chapter.s, o, q: raw.slice(o, item.line.at + map.at[end - 1] + 1) };
  }

  private chapterLines(chapter: StoryChapter): MappedLine[] {
    let mapped = this.lines.get(chapter.number);
    if (!mapped) {
      const raw = this.raw.get(chapter.s);
      mapped = chapter.lines.map((line, index) => {
        const end = chapter.lines[index + 1]?.at ?? chapter.end;
        const map = raw === undefined ? null : flattenWithOffsets(raw.slice(line.at, end));
        return { line, end, map: map && map.text === line.text ? map : null };
      });
      this.lines.set(chapter.number, mapped);
    }
    return mapped;
  }
}
