import type { ResolvedIndexerConfig } from './indexer-adapter';
import { IndexerKeepaliveService } from './indexer-keepalive.service';
import { IndexerOperationLock } from './indexer-operation-lock';

function config(overrides: Partial<ResolvedIndexerConfig> = {}): ResolvedIndexerConfig {
  return {
    id: 1,
    name: 'myanonamouse',
    color: null,
    adapterType: 'myanonamouse' as ResolvedIndexerConfig['adapterType'],
    baseUrl: 'https://www.myanonamouse.net',
    credential: 'a-session',
    allowPrivateAddress: false,
    categories: { ebook: [], audiobook: [], comic: [] },
    disabledMediaKinds: [],
    isbnSearchDisabled: false,
    settings: null,
    networkProfile: null,
    credentialError: null,
    ...overrides,
  };
}

function makeService(configs: ResolvedIndexerConfig[], adapters: Record<string, { keepalive?: ReturnType<typeof vi.fn> }>) {
  const indexers = {
    resolveEnabledConfigs: vi.fn().mockResolvedValue(configs),
    resolveConfig: vi.fn((id: number) => Promise.resolve(configs.find((item) => item.id === id))),
  };
  const registry = { find: vi.fn((type: string) => adapters[type]) };
  return { service: new IndexerKeepaliveService(indexers as never, registry as never, new IndexerOperationLock()), indexers, registry };
}

describe('IndexerKeepaliveService', () => {
  it('touches every enabled source whose adapter has a session to keep', async () => {
    const keepalive = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService([config(), config({ id: 2, adapterType: 'torznab' })], { myanonamouse: { keepalive }, torznab: {} });

    await service.tick();

    expect(keepalive).toHaveBeenCalledTimes(1);
  });

  /**
   * There is nothing to refresh from: the stored session cannot be read, so a keepalive would open
   * an unauthenticated one and, on an adapter that rotates, write it back over the original. The
   * fix is the encryption key, not another round trip.
   */
  it('skips a source whose stored credential cannot be read', async () => {
    const keepalive = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService([config({ credentialError: 'BOOK_REQUEST_ENCRYPTION_KEY may have changed' })], {
      myanonamouse: { keepalive },
    });

    await service.tick();

    expect(keepalive).not.toHaveBeenCalled();
  });

  it('carries on to the next source when one refuses', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('the tracker is down'));
    const working = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService(
      [config(), config({ id: 2, name: 'other', adapterType: 'other-tracker' as ResolvedIndexerConfig['adapterType'] })],
      {
        myanonamouse: { keepalive: failing },
        'other-tracker': { keepalive: working },
      },
    );

    await service.tick();

    expect(working).toHaveBeenCalledTimes(1);
  });

  /**
   * The failure the per-source bound exists for. Errors were already handled here; a hang was not,
   * and the `running` latch is only cleared when the sweep returns - so one adapter that never
   * settled stopped every future tick for the life of the process, visible only as sessions
   * quietly lapsing weeks later. The bound itself is `withDeadline`, proven in
   * `with-deadline.utils.test.ts` where it costs milliseconds rather than the real minute.
   */
  it('releases the latch after a source failed, so the next tick still runs', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('the tracker never finished'));
    const { service, indexers } = makeService([config()], { myanonamouse: { keepalive: failing } });

    await service.tick();
    await service.tick();

    expect(indexers.resolveEnabledConfigs).toHaveBeenCalledTimes(2);
  });

  it('does not start a second sweep on top of one already running', async () => {
    let release!: () => void;
    const keepalive = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { service, indexers } = makeService([config()], { myanonamouse: { keepalive } });

    const first = service.tick();
    await vi.waitFor(() => expect(keepalive).toHaveBeenCalledTimes(1));
    await service.tick();
    release();
    await first;

    expect(indexers.resolveEnabledConfigs).toHaveBeenCalledTimes(1);
  });
});
