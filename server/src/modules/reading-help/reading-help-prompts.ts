import type { ReadingHelpKind, ReadingHelpScope } from '@bookorbit/types';

/**
 * What the model is told for each kind of answer. These follow the apps' on-device prompts, so an
 * answer reads the same whichever model wrote it. Nothing here names the book or its author: the
 * model has nothing to recall about the story beyond the passages it is given, which the app took
 * from before the reader's page.
 *
 * Bump a kind's version whenever its prompt or its sentence cap changes, so cached answers written
 * from the old one are not served again.
 */
export const READING_HELP_PROMPT_VERSIONS: Record<ReadingHelpKind, number> = {
  term: 1,
  description: 1,
  'recap-note': 1,
  'recap-stop': 1,
};

export interface ReadingHelpPromptInput {
  kind: ReadingHelpKind;
  /** An English name for the language, such as "German". */
  language: string;
  term?: string;
  scope: ReadingHelpScope;
  passages: string[];
}

export interface ReadingHelpPrompt {
  system: string;
  user: string;
  /** The answer stops after this many sentences, as on the device. */
  maxSentences: number;
}

const FAITHFUL = `- Say only what the SOURCE states outright. Leave out anything you would have to guess, and anything you know about this book or its author from elsewhere.
- In dialogue, check who speaks and who acts. Never give one character's words, actions or plans to another.`;

function faithful(source: string): string {
  return FAITHFUL.replace('SOURCE', source);
}

export function readingHelpPrompt(input: ReadingHelpPromptInput): ReadingHelpPrompt {
  switch (input.kind) {
    case 'term':
    case 'description':
      return input.scope === 'chapter' && input.kind === 'term' ? chapterTerm(input) : bookTerm(input);
    case 'recap-note':
      return note(input);
    case 'recap-stop':
      return stop(input);
  }
}

function numbered(passages: string[]): string {
  return passages.map((passage, index) => `[${index + 1}] ${passage}`).join('\n\n');
}

function bookTerm({ language, term = '', passages }: ReadingHelpPromptInput): ReadingHelpPrompt {
  const system = `You remind a reader who or what something is in a book they are partway through. You get the words they selected and numbered passages from the pages they have read, in reading order: the first passage is where it first appears and the last ones are where the reader is now.
Rules:
${faithful('passages')}
- Write two short sentences of plain prose: first what it is (a person, creature, place, object or idea) and its part in the story, then the latest thing that happens with it.
- Begin the first sentence with the selected subject's name, adding "The" only when ordinary grammar needs it.
- Do not mention the passages, and use no lists or quotations.
Respond in ${language}.`;
  const user = `Selected words: "${term}"

Passages:
${numbered(passages)}

Who or what is "${term}" in the story so far? Answer in two sentences. Respond in ${language}.`;
  return { system, user, maxSentences: 2 };
}

function chapterTerm({ language, term = '', passages }: ReadingHelpPromptInput): ReadingHelpPrompt {
  const system = `You remind a reader what has happened with something in the chapter they are reading. You get the words they selected and numbered passages from that chapter, up to where the reader is, in reading order.
Rules:
${faithful('passages')}
- Write two or three short sentences of plain prose about what it has done or what has happened with it in this chapter so far, in the order it happened.
- Do not mention the passages, and use no lists or quotations.
Respond in ${language}.`;
  const user = `Selected words: "${term}"

Passages:
${numbered(passages)}

What has happened with "${term}" in this chapter so far? Answer in at most three sentences. Respond in ${language}.`;
  return { system, user, maxSentences: 3 };
}

function note({ language, passages }: ReadingHelpPromptInput): ReadingHelpPrompt {
  const system = `You take notes on a passage from a book for a reader who has just read it, so it can be recalled for them later. You get the passage.
Rules:
${faithful('passage')}
- Begin with one short sentence that gives the main event, naming who is in it. Then add one or two short sentences on what else happens and what has changed by the end.
- Use the names the passage uses, and write plain prose in the present tense with no lists, headings or quotations.
Respond in ${language}.`;
  const user = `Passage:
${passages[0] ?? ''}

What happens in this passage? Answer in at most three sentences, the main event first. Respond in ${language}.`;
  return { system, user, maxSentences: 3 };
}

function stop({ language, passages }: ReadingHelpPromptInput): ReadingHelpPrompt {
  const system = `You remind a reader where they stopped in a book. You get the last pages they read, word for word.
Rules:
${faithful('pages')}
- Write two or three short sentences of plain prose in the present tense: who is there, what is going on, and the last thing that happens.
- Use no lists, headings or quotations.
Respond in ${language}.`;
  const user = `Pages:
${passages[0] ?? ''}

What is going on as these pages end? Answer in at most three sentences. Respond in ${language}.`;
  return { system, user, maxSentences: 3 };
}

/** An English name for a BCP 47 code, the way the prompts say it; English for one that is not a language. */
export function answerLanguage(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(code);
    return name && name !== code ? name : 'English';
  } catch {
    return 'English';
  }
}

/** Plain prose: models sometimes reach for Markdown emphasis they were asked not to use. */
export function cleanAnswer(text: string): string {
  return text.replace(/\*\*/g, '').trim();
}

/**
 * A segment ending in a title or an initial, where ICU's sentence rules break although the sentence
 * goes on: "Mr. Darcy", "J. R. R. Tolkien". V8 does not apply ICU's abbreviation suppressions.
 */
const CARRIES_ON =
  /(?:^|[\s("'\u201C\u2018])(?:Mr|Mrs|Ms|Mx|Dr|Prof|Rev|St|Mt|Sr|Jr|Capt|Col|Gen|Lt|Sgt|Hon|Messrs|Mme|Mlle|Hr|Fr|Sra|Srta)\.$|(?:^|\s)\p{Lu}\.$/u;

/**
 * The first `sentences` sentences once the text has begun another, else null while it has not:
 * the answer is complete at that point, and the rest is not read.
 */
export function cappedAnswer(text: string, sentences: number, language: string): string | null {
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(language, { granularity: 'sentence' });
  } catch {
    segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  }
  let count = 0;
  let end = 0;
  let carrying = false;
  for (const segment of segmenter.segment(text)) {
    const trimmed = segment.segment.trim();
    if (trimmed.length === 0) continue;
    if (!carrying) {
      count++;
      if (count > sentences) return text.slice(0, end).trim();
    }
    carrying = CARRIES_ON.test(trimmed);
    if (!carrying) end = segment.index + segment.segment.length;
  }
  return null;
}
