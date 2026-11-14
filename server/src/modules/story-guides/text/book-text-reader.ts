import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import { Worker } from 'worker_threads';

import { BOOK_TEXT_LIMITS, type BookTextLimits } from './book-text-limits';
import { BookTextError, type BookText, type BookTextFailure } from './book-text.types';
import { FOLIATE_DIR } from './foliate-book-text';

/** A book foliate cannot finish in this time counts as unreadable. */
export const BOOK_TEXT_TIMEOUT_MS = 5 * 60 * 1000;
const BOOK_TEXT_HEAP_MB = 1536;

export interface BookTextWorkerData {
  absolutePath: string;
  foliateDir: string;
  limits: BookTextLimits;
}

export type BookTextWorkerMessage =
  { type: 'result'; result: BookText } | { type: 'error'; errorClass: string; errorMessage: string; reason?: BookTextFailure };

interface BookTextWorkerProcess {
  once(event: 'message', listener: (message: unknown) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export type BookTextWorkerFactory = (data: BookTextWorkerData) => BookTextWorkerProcess;

export interface ReadBookTextOptions {
  foliateDir?: string;
  timeoutMs?: number;
  limits?: Partial<BookTextLimits>;
  createWorker?: BookTextWorkerFactory;
}

export function createBookTextWorker(data: BookTextWorkerData): BookTextWorkerProcess {
  const workerPath = resolveWorkerPath();
  return new Worker(workerPath, {
    workerData: data,
    execArgv: workerPath.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
    resourceLimits: { maxOldGenerationSizeMb: BOOK_TEXT_HEAP_MB },
  });
}

/**
 * Reads a book's sections in a worker thread, so a large or hostile file cannot stall or exhaust
 * the server's own event loop and heap. Throws `BookTextError` with `too-large` for a book past the
 * text limits, which the worker checks before parsing any section, and `unreadable` for anything
 * foliate cannot open in time.
 */
export async function readBookText(absolutePath: string, options: ReadBookTextOptions = {}): Promise<BookText> {
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isFile()) throw new BookTextError('unreadable', 'file is missing');

  const worker = (options.createWorker ?? createBookTextWorker)({
    absolutePath,
    foliateDir: options.foliateDir ?? FOLIATE_DIR,
    limits: { ...BOOK_TEXT_LIMITS, ...options.limits },
  });
  return new Promise<BookText>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      settle(() => reject(new BookTextError('unreadable', 'reading the book timed out')));
      void worker.terminate();
    }, options.timeoutMs ?? BOOK_TEXT_TIMEOUT_MS);
    timer.unref?.();

    worker.once('message', (message) => {
      settle(() => {
        const typed = message as BookTextWorkerMessage | null;
        if (typed?.type === 'result') resolve(typed.result);
        else if (typed?.type === 'error') reject(new BookTextError(typed.reason ?? 'unreadable', typed.errorMessage));
        else reject(new BookTextError('unreadable', 'the text worker answered nothing usable'));
      });
    });
    worker.once('error', (error) => settle(() => reject(new BookTextError('unreadable', error.message))));
    worker.once('exit', (code) => settle(() => reject(new BookTextError('unreadable', `the text worker exited with code ${code}`))));
  });
}

function resolveWorkerPath(): string {
  const jsPath = join(__dirname, 'book-text.worker.js');
  if (existsSync(jsPath)) return jsPath;
  const tsPath = join(__dirname, 'book-text.worker.ts');
  return existsSync(tsPath) ? tsPath : jsPath;
}
