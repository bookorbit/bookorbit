export interface StatsCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  lastAccessedAt: number;
}

export class StatsCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly scopeIndex = new Map<string, Set<string>>();
  private readonly scopeGen = new Map<string, number>();

  constructor(private readonly options: StatsCacheOptions) {}

  async get<T>(scope: string, key: string, load: () => Promise<T>): Promise<T> {
    const fullKey = `${scope}::${key}`;
    const now = Date.now();

    const entry = this.entries.get(fullKey);
    if (entry) {
      if (entry.expiresAt > now) {
        entry.lastAccessedAt = now;
        return entry.value as T;
      }
      this.entries.delete(fullKey);
      this.removeScopeEntry(scope, fullKey);
    }

    const inFlight = this.inFlight.get(fullKey);
    if (inFlight) {
      return inFlight as Promise<T>;
    }

    const gen = this.scopeGen.get(scope) ?? 0;

    const pending = load()
      .then((value) => {
        if ((this.scopeGen.get(scope) ?? 0) === gen) {
          const ts = Date.now();
          this.entries.set(fullKey, { value, expiresAt: ts + this.options.ttlMs, lastAccessedAt: ts });
          if (!this.scopeIndex.has(scope)) {
            this.scopeIndex.set(scope, new Set());
          }
          this.scopeIndex.get(scope)!.add(fullKey);
          this.evict();
        }
        return value;
      })
      .finally(() => {
        this.inFlight.delete(fullKey);
      });

    this.inFlight.set(fullKey, pending as Promise<unknown>);
    return pending;
  }

  clearForScope(scope: string): void {
    this.scopeGen.set(scope, (this.scopeGen.get(scope) ?? 0) + 1);

    const prefix = `${scope}::`;
    for (const fullKey of this.inFlight.keys()) {
      if (fullKey.startsWith(prefix)) {
        this.inFlight.delete(fullKey);
      }
    }

    const keys = this.scopeIndex.get(scope);
    if (!keys) return;
    for (const fullKey of keys) {
      this.entries.delete(fullKey);
    }
    this.scopeIndex.delete(scope);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.scopeIndex.clear();
    this.scopeGen.clear();
  }

  private removeScopeEntry(scope: string, fullKey: string): void {
    const scopeSet = this.scopeIndex.get(scope);
    if (!scopeSet) return;
    scopeSet.delete(fullKey);
    if (scopeSet.size === 0) {
      this.scopeIndex.delete(scope);
    }
  }

  private evict(): void {
    const now = Date.now();

    for (const [fullKey, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        const scope = fullKey.split('::')[0];
        this.entries.delete(fullKey);
        this.removeScopeEntry(scope, fullKey);
      }
    }

    while (this.entries.size > this.options.maxEntries) {
      let lruKey: string | undefined;
      let lruTime = Infinity;
      for (const [fullKey, entry] of this.entries) {
        if (entry.lastAccessedAt < lruTime) {
          lruTime = entry.lastAccessedAt;
          lruKey = fullKey;
        }
      }
      if (!lruKey) break;
      const scope = lruKey.split('::')[0];
      this.entries.delete(lruKey);
      this.removeScopeEntry(scope, lruKey);
    }
  }
}
