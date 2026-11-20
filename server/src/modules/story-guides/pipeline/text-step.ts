import { AiJobFailure, type AiStep } from '../../ai-jobs/ai-feature';
import type { BookText } from '../text/book-text.types';
import { flattenSectionText } from '../text/section-text';
import { sectionParts, type SectionPart } from '../text/section-parts';
import type { StorySection } from '../text/story-sections';
import type { StoryGuideSubject } from './story-guide-subject';

/** Passages for the model aim for this many characters, cut at line breaks. */
export const PASSAGE_CHARS = 9000;

/** One line of model input: a block's text, flattened, and where the block starts in the raw text. */
export interface StoryLine {
  at: number;
  text: string;
}

/** A story section, numbered from 1 in reading order, as the model reads it. */
export interface StoryChapter {
  number: number;
  /** Index in the reader's `book.sections`. */
  s: number;
  title: string | null;
  /** The story's range in the section's raw text. */
  start: number;
  end: number;
  lines: StoryLine[];
  /** Parts for the `lines` step: one, unless the section is long (raw offsets). */
  parts: SectionPart[];
}

/** One unit of the `names` and `ties` steps. */
export interface StoryPassage {
  /** Stable: `c<chapter>p<part>`. */
  id: string;
  chapter: number;
  part: number;
  s: number;
  /** Raw offsets in the section text this passage covers. */
  start: number;
  end: number;
  /** The model input: one line per block, flattened, joined with line breaks. */
  text: string;
}

export interface TextStepResult {
  key: string;
  chapters: StoryChapter[];
  passages: StoryPassage[];
}

/**
 * The model's lines for a section's story range: one per block, flattened, empty ones skipped.
 * The raw text has nothing between blocks, so a heading would otherwise run into its first
 * paragraph; the line breaks come from the block list and each line remembers its raw offset.
 */
export function storyLines(text: string, blocks: readonly number[], start: number, end: number): StoryLine[] {
  const bounds = [...blocks.filter((block) => block > start && block < end), end];
  const lines: StoryLine[] = [];
  let from = start;
  for (const to of bounds) {
    const line = flattenSectionText(text.slice(from, to));
    if (line) lines.push({ at: from, text: line });
    from = to;
  }
  return lines;
}

/**
 * Cuts a chapter into passages of about `PASSAGE_CHARS` characters at line breaks, as the
 * reference pipeline does: as many parts as the length needs, each filled to the even share.
 */
export function chapterPassages(chapter: StoryChapter): StoryPassage[] {
  const total = chapter.lines.reduce((sum, line, index) => sum + line.text.length + (index > 0 ? 1 : 0), 0);
  const count = Math.max(1, Math.ceil(total / PASSAGE_CHARS));
  const target = total / count;
  const groups: StoryLine[][] = [];
  let current: StoryLine[] = [];
  let size = 0;
  for (const line of chapter.lines) {
    if (current.length > 0 && size + line.text.length > target && groups.length + 1 < count) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.text.length + 1;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((lines, index) => ({
    id: `c${chapter.number}p${index + 1}`,
    chapter: chapter.number,
    part: index + 1,
    s: chapter.s,
    start: index === 0 ? chapter.start : lines[0].at,
    end: index + 1 < groups.length ? groups[index + 1][0].at : chapter.end,
    text: lines.map((line) => line.text).join('\n'),
  }));
}

/** The `text` step's output: the story sections as chapters, and their passages. */
export function textStep(book: BookText, sections: readonly StorySection[], key: string): TextStepResult {
  const byIndex = new Map(book.sections.map((section) => [section.index, section]));
  const chapters = sections.map((section, position): StoryChapter => {
    const source = byIndex.get(section.s);
    const text = source?.text ?? '';
    const blocks = source?.blocks ?? [];
    const story = text.slice(section.start, section.end);
    const storyBlocks = blocks.filter((block) => block >= section.start && block < section.end).map((block) => block - section.start);
    const parts = sectionParts(story, storyBlocks.length > 0 ? storyBlocks : [0]).map((part) => ({
      ...part,
      start: part.start + section.start,
      end: part.end + section.start,
    }));
    return {
      number: position + 1,
      s: section.s,
      title: section.title,
      start: section.start,
      end: section.end,
      lines: storyLines(text, blocks, section.start, section.end),
      parts,
    };
  });
  return { key, chapters, passages: chapters.flatMap(chapterPassages) };
}

/** Reads the subject's file again for a build. */
export interface StoryTextSource {
  read(file: StoryGuideSubject['file']): Promise<{ book: BookText; sections: StorySection[]; key: string }>;
}

/** The `text` step: code only, one unit for the book. A file whose text changed since its key was read fails the job. */
export function textAiStep(source: StoryTextSource): AiStep<StoryGuideSubject> {
  return {
    id: 'text',
    version: 1,
    slot: null,
    dependsOn: [],
    units: () => [{ id: 'book' }],
    fingerprint: (ctx) => ctx.subject.key,
    async run(ctx) {
      let read: Awaited<ReturnType<StoryTextSource['read']>>;
      try {
        read = await source.read(ctx.subject.file);
      } catch (error) {
        throw new AiJobFailure('unreadable', error instanceof Error ? error.message : String(error));
      }
      if (read.key !== ctx.subject.key) throw new AiJobFailure('source-changed', "the file's text changed since its key was read");
      return textStep(read.book, read.sections, read.key);
    },
  };
}
