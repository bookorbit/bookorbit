import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BookFileTextRow, NewBookFileTextRow } from '../../db/schema';
import { readBookText } from './text/book-text-reader';
import { BookTextError, type BookText } from './text/book-text.types';
import { STORY_TEXT_EXTRACTION_VERSION } from './text/extraction-version';
import { storyLanguage } from './text/story-language';
import { STORY_MIN_WORDS, storySections, storyTextKey, type StorySection } from './text/story-sections';
import { StoryTextRepository } from './story-text.repository';
import { isStoryTextFormat, STORY_TEXT_KEY_MOVES, type StoryTextFile, type StoryTextKeyMoves, type StoryTextRefusal } from './story-text.types';

export const STORY_TEXT_READER = Symbol('STORY_TEXT_READER');
export type StoryTextReader = (absolutePath: string) => Promise<BookText>;
/** Told the book a file belongs to once that file's text row is saved, so its page can ask again. */
export type StoryTextComputedListener = (bookId: number) => void;

/** How many stale files the background recompute queues per database read. */
const RECOMPUTE_BATCH = 500;
/** The recompute waits this long after boot, so it never competes with startup. */
const RECOMPUTE_DELAY_MS = 60_000;

/** A file's text read now, for a build. */
export interface StoryTextRead {
  book: BookText;
  sections: StorySection[];
  key: string;
}

function sameTime(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/** Whether a cached row still describes the file as it is on disk, under the current rules. */
export function isFresh(row: BookFileTextRow, file: Pick<StoryTextFile, 'sizeBytes' | 'mtime'>): boolean {
  return (
    row.extractionVersion === STORY_TEXT_EXTRACTION_VERSION && (row.sizeBytes ?? null) === (file.sizeBytes ?? null) && sameTime(row.mtime, file.mtime)
  );
}

/** Why a file's text cannot be built from, given the longest-book setting in words. */
export function storyTextRefusal(row: BookFileTextRow, maxWords: number): StoryTextRefusal | null {
  if (row.outcome === 'too-large') return 'too-large';
  if (row.outcome !== 'ready' || !row.textKey) return 'unreadable';
  if (!row.language) return 'language';
  if (row.words < STORY_MIN_WORDS) return 'too-short';
  if (row.words > maxWords) return 'too-long';
  return null;
}

/**
 * Text keys for book files. Status only reads the cache: a file with no fresh row is queued for
 * the key job and reported as `checking`, and every saved row is announced to `onComputed`
 * listeners so the page hears when checking is over. The key job reads one file at a time, in a worker, and a
 * change of extraction version recomputes every key in the background, moving each guide to its
 * file's new key.
 */
@Injectable()
export class StoryTextService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoryTextService.name);
  private readonly queue: number[] = [];
  private readonly queued = new Set<number>();
  private draining: Promise<void> | null = null;
  private readonly computedListeners = new Set<StoryTextComputedListener>();
  private recomputeTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly repository: StoryTextRepository,
    @Optional() @Inject(STORY_TEXT_KEY_MOVES) private readonly moves: StoryTextKeyMoves | null = null,
    @Optional() @Inject(STORY_TEXT_READER) private readonly reader: StoryTextReader = (path) => readBookText(path),
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.recomputeTimer = setTimeout(() => void this.queueStale(), RECOMPUTE_DELAY_MS);
    this.recomputeTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.recomputeTimer) clearTimeout(this.recomputeTimer);
  }

  /** The cached row when it is fresh. Otherwise queues the key job and answers null: never reads the file. */
  async cached(file: StoryTextFile): Promise<BookFileTextRow | null> {
    if (!isStoryTextFormat(file.format)) return null;
    const row = await this.repository.find(file.id);
    if (row && isFresh(row, file)) return row;
    this.enqueue(file.id);
    return null;
  }

  /** The file as the key job reads it, or null when it is gone. */
  file(fileId: number): Promise<StoryTextFile | null> {
    return this.repository.findFile(fileId);
  }

  /**
   * The fresh row, reading the file now when there is none: for a build request and a running job,
   * never for status. Null when the file is not in a story format.
   */
  async current(file: StoryTextFile): Promise<BookFileTextRow | null> {
    if (!isStoryTextFormat(file.format)) return null;
    const row = await this.repository.find(file.id);
    if (row && isFresh(row, file)) return row;
    return await this.compute(file.id);
  }

  /** Queues a file for the key job, once. */
  enqueue(fileId: number): void {
    if (this.stopped || this.queued.has(fileId)) return;
    this.queued.add(fileId);
    this.queue.push(fileId);
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
  }

  /** Hears every saved text row, from the key job and from a build. Returns the unsubscribe. */
  onComputed(listener: StoryTextComputedListener): () => void {
    this.computedListeners.add(listener);
    return () => this.computedListeners.delete(listener);
  }

  /** Resolves when the key job has nothing left to do. */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  /** Reads a file's text now, for the `text` step of a build. Throws `BookTextError`. */
  async read(file: StoryTextFile): Promise<StoryTextRead> {
    const book = await this.reader(file.absolutePath);
    const sections = storySections(book);
    return { book, sections, key: storyTextKey(book, sections, STORY_TEXT_EXTRACTION_VERSION) };
  }

  /** Runs the key job for one file now. Null when the file is gone or not in a story format. */
  async compute(fileId: number): Promise<BookFileTextRow | null> {
    const file = await this.repository.findFile(fileId);
    if (!file || !isStoryTextFormat(file.format)) return null;
    const previous = await this.repository.find(fileId);
    const started = Date.now();
    const row: NewBookFileTextRow = {
      fileId,
      sizeBytes: file.sizeBytes,
      mtime: file.mtime,
      extractionVersion: STORY_TEXT_EXTRACTION_VERSION,
      outcome: 'ready',
      textKey: null,
      previousKey: null,
      language: null,
      words: 0,
      sections: [],
    };
    try {
      const { book, sections, key } = await this.read(file);
      const language = storyLanguage(
        book.languages,
        sections.map((section) => book.sections[section.s]?.text.slice(section.start, section.end) ?? ''),
      );
      row.textKey = key;
      row.language = language.language;
      row.words = sections.reduce((total, section) => total + section.words, 0);
      row.sections = sections;
    } catch (error) {
      row.outcome = error instanceof BookTextError ? error.reason : 'unreadable';
      if (row.outcome !== 'too-large')
        this.logger.warn(
          `[story_text.key] [fail] fileId=${fileId} durationMs=${Date.now() - started} errorClass=${(error as Error)?.name ?? 'Error'} error="${sanitizeLogValue(String((error as Error)?.message ?? error)).slice(0, 200)}" - reading the book's text failed`,
        );
    }
    if (previous?.textKey && previous.extractionVersion < STORY_TEXT_EXTRACTION_VERSION && row.textKey && previous.textKey !== row.textKey) {
      row.previousKey = previous.textKey;
      const moved = (await this.moves?.move(previous.textKey, row.textKey).catch(() => false)) ?? false;
      this.logger.log(`[story_text.key_move] [end] fileId=${fileId} moved=${moved} - text key changed with the extraction rules`);
    }
    const saved = await this.repository.save(row);
    for (const listener of this.computedListeners) {
      try {
        listener(file.bookId);
      } catch (error) {
        this.logger.warn(
          `[story_text.key_notify] [fail] fileId=${fileId} bookId=${file.bookId} errorClass=${(error as Error)?.name ?? 'Error'} error="${sanitizeLogValue(String((error as Error)?.message ?? error)).slice(0, 200)}" - telling the book page failed`,
        );
      }
    }
    this.logger.debug(
      `[story_text.key] [end] fileId=${fileId} durationMs=${Date.now() - started} outcome=${saved.outcome} words=${saved.words} sections=${saved.sections.length} - text key computed`,
    );
    return saved;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && !this.stopped) {
      const fileId = this.queue.shift()!;
      try {
        await this.compute(fileId);
      } catch (error) {
        this.logger.error(
          `[story_text.key] [fail] fileId=${fileId} errorClass=${(error as Error)?.name ?? 'Error'} error="${sanitizeLogValue(String((error as Error)?.message ?? error)).slice(0, 200)}" - key job failed`,
        );
      } finally {
        this.queued.delete(fileId);
      }
      // Lowest priority: let every other piece of work on the event loop go first.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /** Queues every file read under an older extraction version, and every file refused as too large. */
  async queueStale(): Promise<number> {
    let after = 0;
    let total = 0;
    for (;;) {
      const ids = await this.repository.staleFileIds(STORY_TEXT_EXTRACTION_VERSION, after, RECOMPUTE_BATCH);
      if (ids.length === 0 || this.stopped) break;
      for (const id of ids) this.enqueue(id);
      total += ids.length;
      after = ids[ids.length - 1];
    }
    if (total > 0) this.logger.log(`[story_text.recompute] [start] files=${total} version=${STORY_TEXT_EXTRACTION_VERSION} - text keys queued again`);
    return total;
  }
}
