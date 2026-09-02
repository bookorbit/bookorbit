import { IndexerCredentialStore } from './indexer-credential-store';

/**
 * A store over one in-memory row, with plaintext standing in for ciphertext. What is under test is
 * which write lands, not the cipher, and the real `RequestCredentialService` is covered on its own.
 */
function makeStore(initial: string | null = 'session-1') {
  const row: { id: number; credentialsEnc: string | null; updatedAt: Date } = {
    id: 4,
    credentialsEnc: initial,
    updatedAt: new Date('2026-08-25T00:00:00Z'),
  };
  const repo = {
    findById: vi.fn(() => Promise.resolve({ ...row })),
    updateCredentialIfCurrent: vi.fn((_id: number, current: string | null, updatedAt: Date, replacement: string) => {
      if (row.credentialsEnc !== current || row.updatedAt.getTime() !== updatedAt.getTime()) return Promise.resolve(false);
      row.credentialsEnc = replacement;
      row.updatedAt = new Date(row.updatedAt.getTime() + 1);
      return Promise.resolve(true);
    }),
  };
  const credentials = {
    encrypt: vi.fn((value: string) => `enc:${value}`),
    decrypt: vi.fn((value: string) => value.replace(/^enc:/, '')),
  };

  return { store: new IndexerCredentialStore(repo as never, credentials as never), repo, credentials, stored: () => row.credentialsEnc };
}

describe('IndexerCredentialStore.rotate', () => {
  it('stores a session rotated from the one the caller was using', async () => {
    const { store, stored } = makeStore();

    await store.rotate(4, 'session-2', 'session-1');

    expect(stored()).toBe('enc:session-2');
  });

  /**
   * A tracker that rotates its session every request has a plugin calling this several times inside
   * one search. The host advances the prior credential after each accepted write, so every save
   * names the session it actually follows.
   */
  it('accepts a chain of rotations inside one search', async () => {
    const { store, stored } = makeStore();

    await store.rotate(4, 'session-2', 'session-1');
    await store.rotate(4, 'session-3', 'session-2');

    expect(stored()).toBe('enc:session-3');
  });

  /**
   * The operator pasted a fresh credential into the settings form while a search was running. The
   * search's rotation follows on from the session it opened with, which is no longer the one that
   * matters, and writing it back would undo the save with no sign anything happened.
   */
  it('refuses a rotation from a session an operator has replaced', async () => {
    const { store, repo, stored } = makeStore('enc:operator-typed-this');

    await store.rotate(4, 'session-2', 'session-1');

    expect(repo.updateCredentialIfCurrent).not.toHaveBeenCalled();
    expect(stored()).toBe('enc:operator-typed-this');
  });

  it('accepts a rotation that follows on from the credential an operator just saved', async () => {
    const { store, stored } = makeStore('enc:operator-typed-this');

    await store.rotate(4, 'session-2', 'operator-typed-this');

    expect(stored()).toBe('enc:session-2');
  });

  /**
   * Two searches and the keepalive tick can be in flight against one row at once. Unserialized,
   * each reads before any of them writes, so all three pass the check and the last to land wins
   * whether or not its session was the newest.
   */
  it('serializes concurrent rotations rather than letting them interleave', async () => {
    const { store, repo, stored } = makeStore();

    await Promise.all([store.rotate(4, 'session-2', 'session-1'), store.rotate(4, 'session-3', 'session-2')]);

    expect(repo.updateCredentialIfCurrent).toHaveBeenCalledTimes(2);
    expect(stored()).toBe('enc:session-3');
  });

  /** An indexer deleted mid-search has nothing to rotate, and re-creating its row is not our job. */
  it('writes nothing for an indexer that no longer exists', async () => {
    const { store, repo } = makeStore();
    repo.findById.mockResolvedValue(undefined as never);

    await store.rotate(4, 'session-2', 'session-1');

    expect(repo.updateCredentialIfCurrent).not.toHaveBeenCalled();
  });

  /**
   * The one value that can still be recovered by putting the encryption key back. Overwriting it
   * with a session opened without it would destroy that.
   */
  it('leaves a stored credential it cannot read alone', async () => {
    const { store, repo, credentials } = makeStore();
    credentials.decrypt.mockImplementation(() => {
      throw new Error('BOOK_REQUEST_ENCRYPTION_KEY may have changed');
    });

    await store.rotate(4, 'session-2', 'session-1');

    expect(repo.updateCredentialIfCurrent).not.toHaveBeenCalled();
  });

  /** A search that found releases must not fail because the write-back could not be stored. */
  it('swallows a failed write rather than failing the search behind it', async () => {
    const { store, repo } = makeStore();
    repo.updateCredentialIfCurrent.mockRejectedValue(new Error('connection lost') as never);

    await expect(store.rotate(4, 'session-2', 'session-1')).resolves.toBe(false);
  });

  it('does not overwrite an operator save that lands after the credential was read', async () => {
    const { store, repo, stored } = makeStore();
    repo.updateCredentialIfCurrent.mockImplementationOnce(() => Promise.resolve(false));

    await expect(store.rotate(4, 'session-2', 'session-1')).resolves.toBe(false);

    expect(stored()).toBe('session-1');
  });
});
