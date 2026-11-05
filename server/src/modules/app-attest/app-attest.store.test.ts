import { AppAttestController } from './app-attest.controller';
import { AppAttestStore, type StoredAppAttestKey } from './app-attest.store';

function storedKey(overrides: Partial<StoredAppAttestKey> & Pick<StoredAppAttestKey, 'keyId' | 'userId'>): StoredAppAttestKey {
  return {
    publicKeyPem: 'pem',
    appId: 'TEAM.app',
    environment: 'production',
    counter: 0,
    recentCounters: new Set(),
    registeredAt: new Date(0),
    ...overrides,
  };
}

describe('AppAttestStore limits', () => {
  it('keeps one account from pushing out another account challenges', () => {
    const store = new AppAttestStore();
    store.addChallenge('theirs', 2);
    for (let i = 0; i < 100; i++) store.addChallenge(`mine-${i}`, 1);

    expect(store.consumeChallenge('theirs', 2)).toBe(true);
    expect(store.consumeChallenge('mine-0', 1)).toBe(false);
    expect(store.consumeChallenge('mine-99', 1)).toBe(true);
  });

  it('keeps the newest challenges of a user over their limit', () => {
    const store = new AppAttestStore();
    for (let i = 0; i < 25; i++) store.addChallenge(`c${i}`, 1);

    const survivors = Array.from({ length: 25 }, (_, i) => store.consumeChallenge(`c${i}`, 1)).filter(Boolean);
    expect(survivors).toHaveLength(20);
    expect(store.consumeChallenge('c4', 1)).toBe(false);
  });

  it('drops the least recently used key of a user over their limit, never the new one', () => {
    const store = new AppAttestStore();
    for (let i = 0; i < 20; i++) store.saveKey(storedKey({ keyId: `key-${i}`, userId: 1, registeredAt: new Date(1_000 + i) }));
    store.findKey('key-0')!.lastAssertionAt = new Date(9_000);
    store.saveKey(storedKey({ keyId: 'newest', userId: 1, registeredAt: new Date(2_000) }));

    expect(store.keysForUser(1)).toHaveLength(20);
    expect(store.findKey('key-0')).toBeDefined();
    expect(store.findKey('key-1')).toBeUndefined();
    expect(store.findKey('newest')).toBeDefined();
  });

  it('does not count one account keys against another', () => {
    const store = new AppAttestStore();
    for (let i = 0; i < 20; i++) store.saveKey(storedKey({ keyId: `a-${i}`, userId: 1 }));
    store.saveKey(storedKey({ keyId: 'b-0', userId: 2 }));

    expect(store.keysForUser(1)).toHaveLength(20);
    expect(store.keysForUser(2)).toHaveLength(1);
  });
});

describe('AppAttestController throttling', () => {
  it.each(['createChallenge', 'registerKey'] as const)('limits %s per minute', (handler) => {
    const prototype = AppAttestController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', prototype[handler])).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', prototype[handler])).toBe(60_000);
  });
});
