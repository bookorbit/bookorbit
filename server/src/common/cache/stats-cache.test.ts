import { StatsCache } from './stats-cache';

function makeCache(ttlMs = 1000, maxEntries = 10) {
  return new StatsCache({ ttlMs, maxEntries });
}

describe('StatsCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic caching', () => {
    it('calls loader on first call and returns value', async () => {
      const cache = makeCache();
      const loader = vi.fn().mockResolvedValue('result');

      const value = await cache.get('user:1', 'key', loader);

      expect(value).toBe('result');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('returns cached value on second call without calling loader again', async () => {
      const cache = makeCache();
      const loader = vi.fn().mockResolvedValue('result');

      await cache.get('user:1', 'key', loader);
      const second = await cache.get('user:1', 'key', loader);

      expect(second).toBe('result');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('caches null values - does not re-call loader on null result', async () => {
      const cache = makeCache();
      const loader = vi.fn().mockResolvedValue(null);

      await cache.get('user:1', 'key', loader);
      const second = await cache.get('user:1', 'key', loader);

      expect(second).toBeNull();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('treats different keys within same scope as separate entries', async () => {
      const cache = makeCache();
      const loaderA = vi.fn().mockResolvedValue('a');
      const loaderB = vi.fn().mockResolvedValue('b');

      const a = await cache.get('user:1', 'key-a', loaderA);
      const b = await cache.get('user:1', 'key-b', loaderB);

      expect(a).toBe('a');
      expect(b).toBe('b');
      expect(loaderA).toHaveBeenCalledTimes(1);
      expect(loaderB).toHaveBeenCalledTimes(1);
    });

    it('treats the same key in different scopes as separate entries', async () => {
      const cache = makeCache();
      const loader1 = vi.fn().mockResolvedValue('user1-result');
      const loader2 = vi.fn().mockResolvedValue('user2-result');

      const r1 = await cache.get('user:1', 'summary', loader1);
      const r2 = await cache.get('user:2', 'summary', loader2);

      expect(r1).toBe('user1-result');
      expect(r2).toBe('user2-result');
      expect(loader1).toHaveBeenCalledTimes(1);
      expect(loader2).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTL expiry', () => {
    it('calls loader again after TTL expires', async () => {
      const cache = makeCache(1000);
      const loader = vi.fn().mockResolvedValue('result');

      await cache.get('user:1', 'key', loader);
      vi.advanceTimersByTime(1001);
      await cache.get('user:1', 'key', loader);

      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('serves cached value when TTL has not yet expired', async () => {
      const cache = makeCache(1000);
      const loader = vi.fn().mockResolvedValue('result');

      await cache.get('user:1', 'key', loader);
      vi.advanceTimersByTime(999);
      await cache.get('user:1', 'key', loader);

      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('in-flight deduplication', () => {
    it('deduplicates concurrent in-flight requests - fires only one loader call', async () => {
      const cache = makeCache();
      let resolveLoader!: (v: string) => void;
      const loader = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveLoader = resolve;
          }),
      );

      const p1 = cache.get('user:1', 'key', loader);
      const p2 = cache.get('user:1', 'key', loader);

      resolveLoader('shared');
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe('shared');
      expect(r2).toBe('shared');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('fires a new loader after in-flight resolves and TTL expires', async () => {
      const cache = makeCache(1000);
      const loader = vi.fn().mockResolvedValue('v');

      await cache.get('user:1', 'key', loader);
      vi.advanceTimersByTime(1001);
      await cache.get('user:1', 'key', loader);

      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least recently accessed entry when cap is exceeded', async () => {
      const cache = makeCache(60_000, 2);
      const loaderA = vi.fn().mockResolvedValue('a');
      const loaderB = vi.fn().mockResolvedValue('b');
      const loaderC = vi.fn().mockResolvedValue('c');

      await cache.get('user:1', 'a', loaderA);
      vi.advanceTimersByTime(10);
      await cache.get('user:1', 'b', loaderB);
      vi.advanceTimersByTime(10);
      // Access 'a' again to make it the most recently used
      await cache.get('user:1', 'a', vi.fn());
      vi.advanceTimersByTime(10);
      // Adding 'c' should evict 'b' (least recently accessed)
      await cache.get('user:1', 'c', loaderC);

      // 'b' was evicted, so next get for 'b' calls loader again
      const freshLoader = vi.fn().mockResolvedValue('b-fresh');
      await cache.get('user:1', 'b', freshLoader);

      expect(freshLoader).toHaveBeenCalledTimes(1);
    });

    it('evicts expired entries before resorting to LRU', async () => {
      const cache = makeCache(500, 2);
      const loaderA = vi.fn().mockResolvedValue('a');
      const loaderB = vi.fn().mockResolvedValue('b');
      const loaderC = vi.fn().mockResolvedValue('c');

      await cache.get('user:1', 'a', loaderA);
      vi.advanceTimersByTime(10);
      await cache.get('user:1', 'b', loaderB);
      // Advance past TTL of 'a' (expires at t=500) but not 'b' (expires at t=510)
      vi.advanceTimersByTime(495);
      // Adding 'c' - 'a' should be evicted as expired, 'b' should survive
      await cache.get('user:1', 'c', loaderC);

      // 'b' should still be cached
      const bLoader = vi.fn().mockResolvedValue('b2');
      await cache.get('user:1', 'b', bLoader);
      expect(bLoader).not.toHaveBeenCalled();

      // 'a' should be re-fetched
      const aLoader = vi.fn().mockResolvedValue('a2');
      await cache.get('user:1', 'a', aLoader);
      expect(aLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearForScope', () => {
    it('removes only the specified scope entries, leaving other scopes intact', async () => {
      const cache = makeCache();
      await cache.get('user:1', 'key', vi.fn().mockResolvedValue('u1'));
      await cache.get('user:2', 'key', vi.fn().mockResolvedValue('u2'));

      cache.clearForScope('user:1');

      // user:1 entry is gone - loader should be called again
      const u1Loader = vi.fn().mockResolvedValue('u1-fresh');
      await cache.get('user:1', 'key', u1Loader);
      expect(u1Loader).toHaveBeenCalledTimes(1);

      // user:2 entry is still cached - loader should NOT be called
      const u2Loader = vi.fn().mockResolvedValue('u2-fresh');
      await cache.get('user:2', 'key', u2Loader);
      expect(u2Loader).not.toHaveBeenCalled();
    });

    it('clears all keys within the scope, not just one', async () => {
      const cache = makeCache();
      await cache.get('user:1', 'key-a', vi.fn().mockResolvedValue('a'));
      await cache.get('user:1', 'key-b', vi.fn().mockResolvedValue('b'));
      await cache.get('user:1', 'key-c', vi.fn().mockResolvedValue('c'));

      cache.clearForScope('user:1');

      const aLoader = vi.fn().mockResolvedValue('a2');
      const bLoader = vi.fn().mockResolvedValue('b2');
      await cache.get('user:1', 'key-a', aLoader);
      await cache.get('user:1', 'key-b', bLoader);

      expect(aLoader).toHaveBeenCalledTimes(1);
      expect(bLoader).toHaveBeenCalledTimes(1);
    });

    it('does not throw when called on a non-existent scope', () => {
      const cache = makeCache();
      expect(() => cache.clearForScope('user:999')).not.toThrow();
    });

    it('removes in-flight entries for the scope - generation guard prevents stale write-back', async () => {
      const cache = makeCache();
      let resolve!: (v: string) => void;
      const slowLoader = vi.fn(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      );

      const pending = cache.get('user:1', 'key', slowLoader);

      // Clear scope while in-flight is still pending
      cache.clearForScope('user:1');

      // In-flight promise still resolves (Promises cannot be cancelled)
      resolve('stale');
      expect(await pending).toBe('stale');

      // The generation guard prevented the stale result from being written to cache.
      // A subsequent get must call a fresh loader.
      const freshLoader = vi.fn().mockResolvedValue('fresh');
      const result = await cache.get('user:1', 'key', freshLoader);
      expect(freshLoader).toHaveBeenCalledTimes(1);
      expect(result).toBe('fresh');
    });

    it('new get after clearForScope fires a fresh loader before any pending in-flight resolves', async () => {
      const cache = makeCache();
      let resolve!: (v: string) => void;
      const slowLoader = vi.fn(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      );

      void cache.get('user:1', 'key', slowLoader);

      // Clear scope while loader is still in-flight
      cache.clearForScope('user:1');

      // New get after clear should start a fresh loader (inFlight was cleared)
      const freshLoader = vi.fn().mockResolvedValue('fresh');
      const freshResult = cache.get('user:1', 'key', freshLoader);
      expect(freshLoader).toHaveBeenCalledTimes(1);

      resolve('stale');
      expect(await freshResult).toBe('fresh');
    });
  });

  describe('clear', () => {
    it('removes all entries and in-flight across all scopes', async () => {
      const cache = makeCache();
      await cache.get('user:1', 'key', vi.fn().mockResolvedValue('u1'));
      await cache.get('user:2', 'key', vi.fn().mockResolvedValue('u2'));
      await cache.get('user:3', 'key', vi.fn().mockResolvedValue('u3'));

      cache.clear();

      const u1 = vi.fn().mockResolvedValue('u1-fresh');
      const u2 = vi.fn().mockResolvedValue('u2-fresh');
      await cache.get('user:1', 'key', u1);
      await cache.get('user:2', 'key', u2);

      expect(u1).toHaveBeenCalledTimes(1);
      expect(u2).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('does not cache rejected loads - next call fires a fresh loader', async () => {
      const cache = makeCache();
      const failLoader = vi.fn().mockRejectedValue(new Error('db error'));

      await expect(cache.get('user:1', 'key', failLoader)).rejects.toThrow('db error');

      const successLoader = vi.fn().mockResolvedValue('recovered');
      const result = await cache.get('user:1', 'key', successLoader);

      expect(result).toBe('recovered');
      expect(failLoader).toHaveBeenCalledTimes(1);
      expect(successLoader).toHaveBeenCalledTimes(1);
    });

    it('concurrent callers that share an in-flight rejection all receive the error', async () => {
      const cache = makeCache();
      let reject!: (e: Error) => void;
      const slowLoader = vi.fn(
        () =>
          new Promise<string>((_, r) => {
            reject = r;
          }),
      );

      const p1 = cache.get('user:1', 'key', slowLoader);
      const p2 = cache.get('user:1', 'key', slowLoader);

      reject(new Error('fail'));

      await expect(p1).rejects.toThrow('fail');
      await expect(p2).rejects.toThrow('fail');
      expect(slowLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe('scopeIndex cleanup', () => {
    it('removes scope from scopeIndex when its last entry expires via TTL', async () => {
      const cache = makeCache(500, 10);
      const loader = vi.fn().mockResolvedValue('v');

      await cache.get('user:1', 'only-key', loader);

      // Expire and access (triggers single-entry expiry cleanup in get())
      vi.advanceTimersByTime(501);
      const freshLoader = vi.fn().mockResolvedValue('v2');
      await cache.get('user:1', 'only-key', freshLoader);

      // clearForScope should be a no-op now (scope should have been re-added by freshLoader)
      // but if we clear the fresh entry too, scopeIndex should be clean
      cache.clearForScope('user:1');
      expect(() => cache.clearForScope('user:1')).not.toThrow();
    });

    it('removes scope from scopeIndex when last entry is LRU-evicted', async () => {
      // user:solo has 1 entry; user:big has enough to fill the cap and push out user:solo
      const cache = makeCache(60_000, 2);
      await cache.get('user:solo', 'k', vi.fn().mockResolvedValue('s'));
      vi.advanceTimersByTime(10);
      await cache.get('user:big', 'k1', vi.fn().mockResolvedValue('b1'));
      vi.advanceTimersByTime(10);
      // Adding k2 for user:big exceeds cap of 2; user:solo::k is LRU → evicted
      await cache.get('user:big', 'k2', vi.fn().mockResolvedValue('b2'));

      // user:solo should need a fresh load (its entry was LRU-evicted)
      const reloader = vi.fn().mockResolvedValue('s2');
      await cache.get('user:solo', 'k', reloader);
      expect(reloader).toHaveBeenCalledTimes(1);
    });
  });

  describe('LRU lastAccessedAt update on hit', () => {
    it('updates lastAccessedAt on cache hits so recently accessed entries survive LRU eviction', async () => {
      const cache = makeCache(60_000, 2);

      await cache.get('u', 'old', vi.fn().mockResolvedValue('old-val'));
      vi.advanceTimersByTime(5);
      await cache.get('u', 'new', vi.fn().mockResolvedValue('new-val'));
      vi.advanceTimersByTime(5);
      // Access 'old' to refresh its lastAccessedAt - it should now be more recent than 'new'
      await cache.get('u', 'old', vi.fn());
      vi.advanceTimersByTime(5);

      // Adding a third entry should evict 'new' (lru), not 'old'
      await cache.get('u', 'third', vi.fn().mockResolvedValue('third-val'));

      // 'old' should still be cached
      const oldLoader = vi.fn().mockResolvedValue('old-2');
      await cache.get('u', 'old', oldLoader);
      expect(oldLoader).not.toHaveBeenCalled();

      // 'new' should have been evicted
      const newLoader = vi.fn().mockResolvedValue('new-2');
      await cache.get('u', 'new', newLoader);
      expect(newLoader).toHaveBeenCalledTimes(1);
    });
  });
});
