import { Injectable } from '@nestjs/common';
import { normalize } from 'path';

@Injectable()
export class SelfWriteRegistry {
  private readonly activeCounts = new Map<string, number>();

  begin(paths: Iterable<string>): void {
    for (const path of paths) {
      const key = normalize(path);
      this.activeCounts.set(key, (this.activeCounts.get(key) ?? 0) + 1);
    }
  }

  end(paths: Iterable<string>): void {
    for (const path of paths) {
      const key = normalize(path);
      const next = (this.activeCounts.get(key) ?? 0) - 1;
      if (next > 0) {
        this.activeCounts.set(key, next);
      } else {
        this.activeCounts.delete(key);
      }
    }
  }

  isSuppressed(path: string): boolean {
    return this.activeCounts.has(normalize(path));
  }

  async track<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
    this.begin(paths);
    try {
      return await fn();
    } finally {
      this.end(paths);
    }
  }
}
