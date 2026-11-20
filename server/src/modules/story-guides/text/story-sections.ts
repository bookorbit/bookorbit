import { createHash } from 'crypto';

import type { BookText } from './book-text.types';
import { flattenSectionText } from './section-text';
import { countWords } from './section-parts';

/** A section shorter than this (in flattened characters) is not a story section. */
export const STORY_SECTION_MIN_CHARS = 2000;
/** A book with fewer story words than this is refused as too short. */
export const STORY_MIN_WORDS = 5000;

/**
 * The app index's matter titles (`StoryLexicon.matterSections`), plus Dune's appendices, which
 * end its story range: "appendix", "terminology of" and "cartographic notes", and the Spanish
 * titles of the same pages. Titles are compared folded, so they are written without accents.
 */
const MATTER_TITLES = new Set([
  'contents',
  'table of contents',
  'dedication',
  'epigraph',
  'credits',
  'colophon',
  'permissions',
  'title page',
  'half title',
  'cover',
  'copyright',
  'copyright page',
  'excerpt',
  'preview',
  'also by',
  'about the author',
  'about the authors',
  'newsletter',
  'praise',
  'endorsements',
  'back cover',
  'landing page',
  'map',
  'maps',
  'notes',
  'index',
  'bibliography',
  'sources',
  'further reading',
  'glossary',
  'thanks',
  'dramatis personae',
  'cast of characters',
  'list of characters',
  'index of characters',
  'characters',
  'contenido',
  'contenidos',
  'tabla de contenido',
  'tabla de contenidos',
  'indice',
  'indice general',
  'dedicatoria',
  'epigrafe',
  'creditos',
  'colofon',
  'portada',
  'portadilla',
  'cubierta',
  'contraportada',
  'contracubierta',
  'derechos de autor',
  'mapa',
  'mapas',
  'notas',
  'bibliografia',
  'fuentes',
  'glosario',
  'personajes',
  'lista de personajes',
  'indice de personajes',
]);

const MATTER_PHRASES = [
  'acknowledg',
  'about the author',
  'about the publisher',
  'about the translator',
  'about the illustrator',
  'also by ',
  'books by ',
  'other titles',
  'by the same author',
  'praise for',
  'reading group',
  'discussion question',
  'questions for discussion',
  'a conversation with',
  'an excerpt',
  'excerpt from',
  'sneak peek',
  'newsletter',
  'coming soon',
  'also available',
  'more from ',
  'copyright',
  'remerciements',
  'danksagung',
  'agradecimientos',
  'ringraziamenti',
  'agradecimentos',
  'foreword by',
  'introduction by',
  'afterword by',
  'note on the text',
  "translator's note",
  'project gutenberg',
  'suggestions for further reading',
  'sobre el autor',
  'sobre la autora',
  'sobre los autores',
  'acerca del autor',
  'acerca de la autora',
  'nota del traductor',
  'nota de la traductora',
  'del mismo autor',
  'de la misma autora',
  'otros titulos',
  'otras obras de',
  'otros libros de',
  'guia de lectura',
  'indice onomastico',
  'appendix',
  'terminology of',
  'cartographic notes',
];

/** Text that opens back matter, for a section the contents do not name. */
const BACK_MATTER_OPENING = /^(acknowledg|about the author|also by|copyright|contents)/i;

const GUTENBERG_MARKER = /\*\*\*\s*(START|END)\s+OF\s+(?:THE|THIS)\s+PROJECT\s+GUTENBERG\s+E?BOOK\b[^*]*\*\*\*/gi;

/** Case and diacritics folded, whitespace and punctuation trimmed from both ends, as the app does. */
export function foldTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
}

export function isMatterTitle(title: string): boolean {
  const folded = foldTitle(title);
  return MATTER_TITLES.has(folded) || MATTER_PHRASES.some((phrase) => folded.includes(phrase));
}

export interface StorySection {
  /** The section's index in `book.sections`. */
  s: number;
  /** Its own first contents title, if it has one. */
  title: string | null;
  /** The section's whole raw text length and hash, which the app checks its own copy against. */
  chars: number;
  h: string;
  /** The story's range within the raw text: all of it, unless a Gutenberg marker falls inside. */
  start: number;
  end: number;
  words: number;
}

/** Which sections lie outside the story by the contents title in force there. */
function matterSections(book: BookText): boolean[] {
  const entries = book.sections.flatMap((section) => section.titles.map((title) => ({ s: section.index, title })));
  const story = entries.filter((entry) => !isMatterTitle(entry.title)).map((entry) => entry.s);
  let label: string | null = null;
  let next = 0;
  return book.sections.map((section) => {
    while (next < entries.length && entries[next].s <= section.index) label = entries[next++].title;
    if (story.length === 0) return false;
    const outside = section.index < story[0] || section.index > story[story.length - 1];
    return outside && label !== null && isMatterTitle(label);
  });
}

/** Each section's story range: only the text between a Gutenberg book's start and end markers. */
function storyRanges(book: BookText): { start: number; end: number }[] {
  const ranges = book.sections.map((section) => ({ start: 0, end: section.text.length }));
  const starts: { s: number; at: number }[] = [];
  const ends: { s: number; at: number }[] = [];
  for (const [s, section] of book.sections.entries()) {
    for (const match of section.text.matchAll(GUTENBERG_MARKER)) {
      if (match[1].toUpperCase() === 'START') starts.push({ s, at: match.index + match[0].length });
      else ends.push({ s, at: match.index });
    }
  }
  if (starts.length === 0 || ends.length === 0) return ranges;
  const first = starts[0];
  const last = ends[ends.length - 1];
  return ranges.map((range, s) => {
    if (s < first.s || s > last.s) return { start: 0, end: 0 };
    return { start: s === first.s ? first.at : range.start, end: s === last.s ? last.at : range.end };
  });
}

/**
 * The story sections: linear sections of at least 2,000 characters inside the Gutenberg markers,
 * minus front and back matter by contents title and back matter by its opening words. A book with
 * no section that long uses every linear section with text.
 */
export function storySections(book: BookText): StorySection[] {
  const matter = matterSections(book);
  const ranges = storyRanges(book);
  const candidates = book.sections.flatMap((section, position) => {
    const { start, end } = ranges[position];
    const flat = flattenSectionText(section.text.slice(start, end));
    if (!section.linear || section.error || !flat) return [];
    const entry: StorySection = {
      s: section.index,
      title: section.titles[0] ?? null,
      chars: section.text.length,
      h: section.hash,
      start,
      end,
      words: countWords(flat),
    };
    return [{ entry, long: flat.length >= STORY_SECTION_MIN_CHARS, story: !matter[position] && !BACK_MATTER_OPENING.test(flat) }];
  });
  const long = candidates.filter((candidate) => candidate.long && candidate.story);
  return (long.length > 0 ? long : candidates).map((candidate) => candidate.entry);
}

/**
 * The text key: the SHA-256 of the story sections' flattened text with their indexes, and the
 * extraction version. Metadata written into a file changes its bytes, not this.
 */
export function storyTextKey(book: BookText, sections: readonly StorySection[], extractionVersion: number): string {
  const hash = createHash('sha256').update(`story-text v${extractionVersion}\n`);
  const byIndex = new Map(book.sections.map((section) => [section.index, section]));
  for (const section of sections) {
    const text = byIndex.get(section.s)?.text ?? '';
    hash.update(`${section.s}\n${flattenSectionText(text.slice(section.start, section.end))}\n`);
  }
  return hash.digest('hex');
}
