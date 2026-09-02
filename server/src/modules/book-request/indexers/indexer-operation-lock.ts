import { Injectable } from '@nestjs/common';

@Injectable()
export class IndexerOperationLock {
  private readonly tails = new Map<number, Promise<void>>();

  async run<T>(indexerId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(indexerId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(indexerId, tail);

    try {
      return await current;
    } finally {
      if (this.tails.get(indexerId) === tail) this.tails.delete(indexerId);
    }
  }
}
