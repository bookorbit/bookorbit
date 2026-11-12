import type { AiSubject } from '../../ai-jobs/ai-feature';
import type { BookFileTextRow } from '../../../db/schema';
import type { StoryTextFile } from '../story-text.types';

/** What a story guide is built for: one book file's text, by its text key. */
export interface StoryGuideSubject extends AiSubject {
  bookId: number;
  file: StoryTextFile;
  text: BookFileTextRow;
  /** The book's title and authors, which the names step drops as entries. */
  title: string;
  authors: string[];
}
