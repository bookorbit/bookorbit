import { SelfWriteRegistry } from './self-write-registry.service';

describe('SelfWriteRegistry', () => {
  it('suppresses normalized paths only while a write is active', () => {
    const registry = new SelfWriteRegistry();

    registry.begin(['/books/author/../book.epub']);

    expect(registry.isSuppressed('/books/book.epub')).toBe(true);
    registry.end(['/books/book.epub']);
    expect(registry.isSuppressed('/books/book.epub')).toBe(false);
  });

  it('reference counts concurrent writes to the same path', () => {
    const registry = new SelfWriteRegistry();
    const path = '/books/a.mp3';

    registry.begin([path]);
    registry.begin([path]);
    registry.end([path]);

    expect(registry.isSuppressed(path)).toBe(true);

    registry.end([path]);
    expect(registry.isSuppressed(path)).toBe(false);
  });

  it('track releases paths after success and failure', async () => {
    const registry = new SelfWriteRegistry();
    const successPath = '/books/success.mp3';
    const failurePath = '/books/failure.mp3';

    await registry.track([successPath], () => {
      expect(registry.isSuppressed(successPath)).toBe(true);
      return Promise.resolve();
    });
    await expect(
      registry.track([failurePath], () => {
        expect(registry.isSuppressed(failurePath)).toBe(true);
        return Promise.reject(new Error('write failed'));
      }),
    ).rejects.toThrow('write failed');

    expect(registry.isSuppressed(successPath)).toBe(false);
    expect(registry.isSuppressed(failurePath)).toBe(false);
  });
});
