import { Injectable } from '@nestjs/common';

@Injectable()
export class FileLockService {
  private readonly locks = new Map<string, Promise<void>>();

  async withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const current = this.locks.get(path) ?? Promise.resolve();
    let release!: () => void;
    const unlock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = current.then(() => unlock);
    this.locks.set(path, chain);

    try {
      await current;
      return await fn();
    } finally {
      release();
      if (this.locks.get(path) === chain) {
        this.locks.delete(path);
      }
    }
  }

  isLocked(path: string): boolean {
    return this.locks.has(path);
  }

  /** Runs `fn` under the lock only when nobody holds or waits for it; otherwise returns null without waiting. */
  tryWithLock<T>(path: string, fn: () => Promise<T>): Promise<T> | null {
    if (this.locks.has(path)) return null;
    return this.withLock(path, fn);
  }
}

export function bookOperationLockKey(bookId: number): string {
  return `book:${bookId}`;
}
