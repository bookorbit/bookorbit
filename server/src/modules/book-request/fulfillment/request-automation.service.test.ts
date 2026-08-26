import { BadRequestException } from '@nestjs/common';
import { DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS } from '@bookorbit/types';
import type { BookRequestAutomationSettings, GrabFailureCode, IndexerSearchStatus, ReleaseCandidateItem } from '@bookorbit/types';

import type { BookRequestDownloadRow, BookRequestRow } from '../../../db/schema';
import { BOOK_REQUEST_DOWNLOAD_FAILED } from '../book-request-events.service';
import { RequestAlreadyClaimedException } from './request-fulfillment.service';
import { RequestAutomationService } from './request-automation.service';

function release(overrides: Partial<ReleaseCandidateItem> = {}): ReleaseCandidateItem {
  return {
    indexerId: 9,
    indexerName: 'tracker',
    guid: 'release-1',
    title: 'Dune [epub]',
    sizeBytes: 2_000_000,
    seeders: 40,
    leechers: 1,
    format: 'epub',
    language: 'en',
    freeleech: false,
    publishedAt: null,
    score: 92,
    reasons: [],
    ...overrides,
  };
}

/** A refusal shaped the way the fulfilment service shapes one, which is what carries the scope. */
function refusal(errorCode: GrabFailureCode, message: string): BadRequestException {
  return new BadRequestException({ message, errorCode, statusCode: 400 });
}

function indexerStatus(indexerId: number, seedsBack: boolean): IndexerSearchStatus {
  return { indexerId, indexerName: `indexer-${indexerId}`, ok: true, count: 1, filtered: 0, seedsBack };
}

function joined(overrides: Partial<BookRequestRow> = {}) {
  return {
    request: {
      id: 7,
      title: 'Dune',
      status: 'approved',
      targetLibraryId: 2,
      mediaKind: 'ebook',
      authors: ['Frank Herbert'],
      ...overrides,
    } as BookRequestRow,
    requesterUsername: 'bob',
    requesterName: 'Bob',
    decidedByUsername: null,
    targetLibraryName: 'Books',
  };
}

function makeService(
  options: {
    settings?: Partial<BookRequestAutomationSettings>;
    request?: Partial<BookRequestRow>;
    releases?: ReleaseCandidateItem[];
    indexers?: IndexerSearchStatus[];
    /** What the instance had to search with. Defaults to one working source, as every case assumes. */
    sourceCounts?: { enabledIndexerCount?: number; configuredIndexerCount?: number; uncoveredIndexerCount?: number };
    attempts?: number;
    tried?: string[];
    /** What the wanted-list sweep finds waiting. Empty everywhere the sweep is not what is under test. */
    due?: Array<{ id: number }>;
    download?: Partial<BookRequestDownloadRow> | null;
  } = {},
) {
  const settings = {
    get: vi.fn().mockResolvedValue({ ...DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS, autoGrabEnabled: true, ...options.settings }),
  };
  const requests = {
    findById: vi.fn().mockResolvedValue(joined(options.request)),
    findDueForResearch: vi.fn().mockResolvedValue(options.due ?? []),
  };
  const downloads = {
    findById: vi
      .fn()
      .mockResolvedValue(
        options.download === null ? undefined : ({ id: 11, requestId: 7, automated: true, ...options.download } as BookRequestDownloadRow),
      ),
    countAutomatedForRequest: vi.fn().mockResolvedValue(options.attempts ?? 0),
    findTriedReleaseKeys: vi.fn().mockResolvedValue(new Set(options.tried ?? [])),
  };
  const releases = {
    search: vi.fn().mockResolvedValue({
      releases: options.releases ?? [release()],
      indexers: options.indexers ?? [],
      enabledIndexerCount: options.sourceCounts?.enabledIndexerCount ?? 1,
      configuredIndexerCount: options.sourceCounts?.configuredIndexerCount ?? 1,
      uncoveredIndexerCount: options.sourceCounts?.uncoveredIndexerCount ?? 0,
      searchedAt: '',
      cached: false,
    }),
  };
  const fulfillment = { grab: vi.fn().mockResolvedValue(undefined), setRequestStatus: vi.fn().mockResolvedValue(true) };
  const events = { on: vi.fn() };
  const notifier = { notifyApprovers: vi.fn().mockResolvedValue(undefined) };
  const searchDelay = { wait: vi.fn().mockResolvedValue(undefined) };

  const service = new RequestAutomationService(
    settings as never,
    requests as never,
    downloads as never,
    releases as never,
    fulfillment as never,
    events as never,
    notifier as never,
    searchDelay as never,
  );

  return { service, settings, requests, downloads, releases, fulfillment, events, notifier, searchDelay };
}

/**
 * Every terminal write is conditional on the status the pass believes the request is in, so the
 * assertions name it: a decline that ran before the claim may only write from what it read, and
 * one that ran after may only write from the `searching` this pass claimed.
 */
const FROM_APPROVED = ['approved'];
const FROM_SEARCHING = ['searching'];

/** `considerRequest` is fire and forget by design, so a test has to let its microtasks drain. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('RequestAutomationService.considerRequest', () => {
  it('does nothing at all while unattended grabbing is off', async () => {
    const { service, fulfillment, releases, notifier } = makeService({ settings: { autoGrabEnabled: false } });

    service.considerRequest(7);
    await settle();

    expect(releases.search).not.toHaveBeenCalled();
    expect(fulfillment.grab).not.toHaveBeenCalled();
    // An approver approved this one and is looking at the queue, so there is nobody to tell and
    // no reason to stamp "automation is off" on an approval nobody asked automation to handle.
    expect(fulfillment.setRequestStatus).not.toHaveBeenCalled();
    expect(notifier.notifyApprovers).not.toHaveBeenCalled();
  });

  /**
   * The stall this whole fix exists for. Nobody decided on the request, its requester cannot open
   * the picker, and with automation off nothing was ever going to look at it.
   */
  it('says why, and tells the approvers, when an auto-approved request meets automation switched off', async () => {
    const { service, fulfillment, notifier } = makeService({ settings: { autoGrabEnabled: false } });

    service.considerRequest(7, 'auto_approval');
    await settle();

    expect(fulfillment.setRequestStatus).toHaveBeenCalledWith(
      7,
      'approved',
      expect.stringContaining('Automatic grabbing is off'),
      { code: 'AUTOMATION_DISABLED', meta: undefined },
      FROM_APPROVED,
    );
    expect(notifier.notifyApprovers).toHaveBeenCalledWith(
      'book_request_needs_release',
      expect.objectContaining({ message: expect.stringContaining('Dune'), meta: { requestId: 7 } }),
    );
  });

  /**
   * `considerRequest` is fire and forget, so the request can be gone by the time it runs. Declining
   * before checking would write `approved` over a status somebody deliberately moved on from.
   */
  it('does not resurrect a request that was cancelled before the attempt ran', async () => {
    const { service, fulfillment, notifier } = makeService({ settings: { autoGrabEnabled: false }, request: { status: 'cancelled' } });

    service.considerRequest(7, 'auto_approval');
    await settle();

    expect(fulfillment.setRequestStatus).not.toHaveBeenCalled();
    expect(notifier.notifyApprovers).not.toHaveBeenCalled();
  });

  /** Every other hand-back already wrote a reason; what none of them did was tell anybody. */
  it('tells the approvers when an auto-approved request is handed back for any other reason', async () => {
    const { service, notifier } = makeService({ releases: [release({ score: 61 })], settings: { autoGrabMinScore: 80 } });

    service.considerRequest(7, 'auto_approval');
    await settle();

    expect(notifier.notifyApprovers).toHaveBeenCalledTimes(1);
  });

  /**
   * The counterpart, and the reason the trigger exists at all: bulk-approving twenty requests must
   * not fan out twenty notifications to every approver about work they are already looking at.
   */
  it('stays quiet when an approver is the one who set the attempt off', async () => {
    const { service, fulfillment, notifier } = makeService({ releases: [release({ score: 61 })], settings: { autoGrabMinScore: 80 } });

    service.considerRequest(7);
    await settle();

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(7, 'approved', expect.any(String), expect.any(Object), FROM_SEARCHING);
    expect(notifier.notifyApprovers).not.toHaveBeenCalled();
  });

  it('grabs the top release when it clears the floor', async () => {
    const { service, fulfillment } = makeService();

    service.considerRequest(7);
    await settle();

    expect(fulfillment.setRequestStatus).toHaveBeenCalledWith(7, 'searching', null, null, FROM_APPROVED);
    expect(fulfillment.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'release-1' }, null);
  });

  /**
   * `considerRequest` is fire and forget, and the guards above the claim ran against a row read
   * some time ago. A request cancelled in between would otherwise cost a search against every
   * enabled tracker for a book nobody is waiting for any more.
   */
  it('searches nothing when the request was settled before the claim landed', async () => {
    const { service, fulfillment, releases } = makeService();
    fulfillment.setRequestStatus.mockResolvedValue(false);

    service.considerRequest(7);
    await settle();

    expect(releases.search).not.toHaveBeenCalled();
    expect(fulfillment.grab).not.toHaveBeenCalled();
  });

  /**
   * `searching` is deliberately grabbable, so an approver can pick a release while a pass is
   * running. Everything the pass hands over afterwards is refused, and its "no release could be
   * started" used to land on the healthy download they just started - which then invited a retry
   * that would grab the same book a second time.
   */
  describe('an approver who grabs a release mid-pass', () => {
    function refusedPass() {
      const harness = makeService();
      harness.fulfillment.grab.mockRejectedValue(refusal('GRAB_RELEASE_REFUSED', 'Another release is already being sent for this request'));
      return harness;
    }

    it('writes the failure only from the searching this pass claimed', async () => {
      const { service, fulfillment } = refusedPass();

      service.considerRequest(7);
      await settle();

      const terminal = fulfillment.setRequestStatus.mock.calls.filter(([, status]) => status === 'failed');
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toEqual([7, 'failed', expect.any(String), null, FROM_SEARCHING]);
    });

    it('claims searching only from the status the guards read', async () => {
      const { service, fulfillment } = makeService({ request: { status: 'failed' } });

      service.considerRequest(7);
      await settle();

      expect(fulfillment.setRequestStatus).toHaveBeenCalledWith(7, 'searching', null, null, ['failed']);
    });

    /** Every remaining candidate would be refused for the same reason, so the list is not worked down. */
    it('stops the candidate list on a claim conflict rather than burning it', async () => {
      const { service, fulfillment } = makeService({
        releases: [release({ guid: 'a', indexerId: 9 }), release({ guid: 'b', indexerId: 8 }), release({ guid: 'c', indexerId: 7 })],
      });
      fulfillment.grab.mockRejectedValue(new RequestAlreadyClaimedException('Another release is already being sent for this request'));

      service.considerRequest(7);
      await settle();

      expect(fulfillment.grab).toHaveBeenCalledTimes(1);
    });
  });

  it('stops after the recommended ISBN when it finds a release that clears the floor', async () => {
    const { service, releases, searchDelay } = makeService({ request: { isbn13: '9780441172719' } });

    service.considerRequest(7);
    await settle();

    expect(releases.search).toHaveBeenCalledTimes(1);
    expect(releases.search).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), { indexerMode: 'all' });
    expect(searchDelay.wait).not.toHaveBeenCalled();
  });

  it('waits once and searches one alternate ISBN when the recommended ISBN is not good enough', async () => {
    const { service, releases, fulfillment, searchDelay } = makeService({
      request: {
        isbn13: '9780441172719',
        metadataSources: [
          {
            providerKey: 'google',
            providerId: 'dune-alt',
            providerLabel: 'Google Books',
            isbn10: null,
            isbn13: '9780593098233',
          },
        ],
      },
    });
    releases.search
      .mockResolvedValueOnce({ releases: [release({ guid: 'weak', score: 60 })], indexers: [], searchedAt: '', cached: false })
      .mockResolvedValueOnce({ releases: [release({ guid: 'alternate', score: 88 })], indexers: [], searchedAt: '', cached: false });

    service.considerRequest(7);
    await settle();

    expect(searchDelay.wait).toHaveBeenCalledTimes(1);
    expect(releases.search).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 7 }), {
      indexerMode: 'isbn-capable',
      overrides: { isbn: '9780593098233' },
    });
    expect(fulfillment.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'alternate' }, null);
  });

  it('waits twice and falls back to title and author after two ISBN searches', async () => {
    const { service, releases, fulfillment, searchDelay } = makeService({
      request: {
        isbn13: '9780441172719',
        metadataSources: [
          {
            providerKey: 'google',
            providerId: 'dune-alt',
            providerLabel: 'Google Books',
            isbn10: null,
            isbn13: '9780593098233',
          },
        ],
      },
    });
    releases.search
      .mockResolvedValueOnce({ releases: [], indexers: [], searchedAt: '', cached: false })
      .mockResolvedValueOnce({ releases: [], indexers: [], searchedAt: '', cached: false })
      .mockResolvedValueOnce({ releases: [release({ guid: 'title-match', score: 86 })], indexers: [], searchedAt: '', cached: false });

    service.considerRequest(7);
    await settle();

    expect(searchDelay.wait).toHaveBeenCalledTimes(2);
    expect(releases.search).toHaveBeenNthCalledWith(3, expect.objectContaining({ id: 7 }), {
      indexerMode: 'isbn-capable',
      overrides: { isbn: null },
    });
    expect(fulfillment.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'title-match' }, null);
  });

  it('waits once before title and author when only one ISBN is available', async () => {
    const { service, releases, fulfillment, searchDelay } = makeService({ request: { isbn13: '9780441172719' } });
    releases.search
      .mockResolvedValueOnce({ releases: [release({ guid: 'same-release', score: 60 })], indexers: [], searchedAt: '', cached: false })
      .mockResolvedValueOnce({ releases: [release({ guid: 'same-release', score: 86 })], indexers: [], searchedAt: '', cached: false });

    service.considerRequest(7);
    await settle();

    expect(searchDelay.wait).toHaveBeenCalledTimes(1);
    expect(releases.search).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 7 }), {
      indexerMode: 'isbn-capable',
      overrides: { isbn: null },
    });
    expect(fulfillment.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'same-release' }, null);
  });

  it('searches title and author once without waiting when the request has no ISBN', async () => {
    const { service, releases, searchDelay } = makeService({ releases: [] });

    service.considerRequest(7);
    await settle();

    expect(releases.search).toHaveBeenCalledTimes(1);
    expect(releases.search).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), { indexerMode: 'all' });
    expect(searchDelay.wait).not.toHaveBeenCalled();
  });

  /** The whole point of the floor: a poor best release is not grabbed just for being the best. */
  it('hands a request back to the approver when nothing clears the floor', async () => {
    const { service, fulfillment } = makeService({ releases: [release({ score: 61 })], settings: { autoGrabMinScore: 80 } });

    service.considerRequest(7);
    await settle();

    expect(fulfillment.grab).not.toHaveBeenCalled();
    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(
      7,
      'approved',
      expect.stringContaining('80'),
      {
        code: 'BELOW_SCORE_FLOOR',
        meta: { floor: 80 },
      },
      FROM_SEARCHING,
    );
  });

  /**
   * The floor, the profile and the tried list are all answers about releases. Reporting one of them
   * for a search that never ran sends the approver to tune a number that had no bearing on it.
   */
  it('says nothing was searched rather than blaming the score floor when no source is enabled', async () => {
    const { service, fulfillment } = makeService({
      releases: [],
      sourceCounts: { enabledIndexerCount: 0, configuredIndexerCount: 0 },
    });

    service.considerRequest(7);
    await settle();

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(
      7,
      'approved',
      expect.any(String),
      {
        code: 'NO_SOURCES_CONFIGURED',
        meta: undefined,
      },
      FROM_SEARCHING,
    );
  });

  it('separates every source being switched off from having none at all', async () => {
    const { service, fulfillment } = makeService({
      releases: [],
      sourceCounts: { enabledIndexerCount: 0, configuredIndexerCount: 4 },
    });

    service.considerRequest(7);
    await settle();

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(
      7,
      'approved',
      expect.any(String),
      {
        code: 'NO_SOURCES_ENABLED',
        meta: undefined,
      },
      FROM_SEARCHING,
    );
  });

  it('says so when sources are enabled but none of them carries this medium', async () => {
    const { service, fulfillment } = makeService({
      releases: [],
      indexers: [],
      sourceCounts: { enabledIndexerCount: 2, configuredIndexerCount: 2, uncoveredIndexerCount: 2 },
    });

    service.considerRequest(7);
    await settle();

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(
      7,
      'approved',
      expect.any(String),
      {
        code: 'MEDIUM_UNCOVERED',
        meta: undefined,
      },
      FROM_SEARCHING,
    );
  });

  it('leaves a request with nowhere to file the book for a human, without searching', async () => {
    const { service, fulfillment, releases } = makeService({ request: { targetLibraryId: null } });

    service.considerRequest(7);
    await settle();

    expect(releases.search).not.toHaveBeenCalled();
    expect(fulfillment.setRequestStatus).toHaveBeenCalledWith(
      7,
      'approved',
      expect.stringContaining('destination library'),
      { code: 'NO_DESTINATION', meta: undefined },
      FROM_APPROVED,
    );
  });

  it('ignores a request that is not in a state a grab may start from', async () => {
    const { service, fulfillment } = makeService({ request: { status: 'pending' } });

    service.considerRequest(7);
    await settle();

    expect(fulfillment.setRequestStatus).not.toHaveBeenCalled();
  });

  /**
   * Nobody classified this one, so nobody can say what a second attempt would do differently.
   * Working down the list on a failure we do not understand is guessing with the budget.
   */
  it('stops at an unclassified failure rather than working down the list', async () => {
    const { service, fulfillment } = makeService();
    fulfillment.grab.mockRejectedValue(new Error('qBittorrent rejected the torrent'));

    service.considerRequest(7);
    await settle();

    expect(fulfillment.grab).toHaveBeenCalledTimes(1);
    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(7, 'failed', 'qBittorrent rejected the torrent', null, FROM_SEARCHING);
  });

  /**
   * The failure this whole path exists for: one tracker refusing an account says nothing about
   * the next source down, and the request used to end there with a second source untouched.
   */
  it('moves to the next source when a tracker refuses the release', async () => {
    const { service, fulfillment } = makeService({
      settings: { autoGrabMinScore: 70 },
      releases: [
        release({ indexerId: 9, guid: 'mam-1', score: 89 }),
        release({ indexerId: 9, guid: 'mam-2', score: 85 }),
        release({ indexerId: 5, indexerName: 'libgen', guid: 'libgen-1', score: 70 }),
      ],
    });
    fulfillment.grab.mockRejectedValueOnce(refusal('GRAB_SOURCE_REFUSED', 'tracker: the tracker answered 406'));

    service.considerRequest(7);
    await settle();

    // The refusing source's second release is never tried: it would answer the same way.
    expect(fulfillment.grab.mock.calls.map((call) => (call[1] as { releaseGuid: string }).releaseGuid)).toEqual(['mam-1', 'libgen-1']);
    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(7, 'searching', null, null, FROM_APPROVED);
  });

  /** A tracker that will not serve a VIP-only release to a free account still serves the rest. */
  it('skips only the VIP-only releases of a source that refused one', async () => {
    const { service, fulfillment } = makeService({
      releases: [
        release({ guid: 'vip-1', vipOnly: true, score: 92 }),
        release({ guid: 'vip-2', vipOnly: true, score: 90 }),
        release({ guid: 'open-1', vipOnly: false, score: 84 }),
      ],
    });
    fulfillment.grab.mockRejectedValueOnce(refusal('GRAB_VIP_REQUIRED', 'you are not VIP or higher'));

    service.considerRequest(7);
    await settle();

    expect(fulfillment.grab.mock.calls.map((call) => (call[1] as { releaseGuid: string }).releaseGuid)).toEqual(['vip-1', 'open-1']);
  });

  /**
   * A download client that is down refuses every torrent alike, and says nothing at all about a
   * source BookOrbit downloads from itself.
   */
  it('keeps trying direct downloads after the torrent client refuses one', async () => {
    const { service, fulfillment } = makeService({
      settings: { autoGrabMinScore: 70 },
      releases: [
        release({ indexerId: 9, guid: 'torrent-1', score: 92 }),
        release({ indexerId: 4, indexerName: 'other-tracker', guid: 'torrent-2', score: 88 }),
        release({ indexerId: 5, indexerName: 'libgen', guid: 'direct-1', score: 70 }),
      ],
      indexers: [indexerStatus(9, true), indexerStatus(4, true), indexerStatus(5, false)],
    });
    fulfillment.grab.mockRejectedValueOnce(refusal('GRAB_CLIENT_REFUSED', 'qBittorrent rejected the torrent'));

    service.considerRequest(7);
    await settle();

    expect(fulfillment.grab.mock.calls.map((call) => (call[1] as { releaseGuid: string }).releaseGuid)).toEqual(['torrent-1', 'direct-1']);
  });

  /** The switch is what "stop at the first failure" means, so it has to stop a classified one too. */
  it('stops at the first refusal when falling back is turned off', async () => {
    const { service, fulfillment } = makeService({
      settings: { autoRetryEnabled: false },
      releases: [release({ guid: 'first' }), release({ indexerId: 5, guid: 'second', score: 80 })],
    });
    fulfillment.grab.mockRejectedValueOnce(refusal('GRAB_SOURCE_REFUSED', 'the tracker answered 406'));

    service.considerRequest(7);
    await settle();

    expect(fulfillment.grab).toHaveBeenCalledTimes(1);
    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(7, 'failed', 'the tracker answered 406', null, FROM_SEARCHING);
  });

  it('spends no more than the configured attempts however many sources are left', async () => {
    const { service, fulfillment } = makeService({
      settings: { maxAutoGrabAttempts: 2 },
      releases: [
        release({ indexerId: 9, guid: 'one', score: 92 }),
        release({ indexerId: 5, indexerName: 'two', guid: 'two', score: 88 }),
        release({ indexerId: 3, indexerName: 'three', guid: 'three', score: 84 }),
      ],
    });
    fulfillment.grab.mockRejectedValue(refusal('GRAB_SOURCE_REFUSED', 'refused'));

    service.considerRequest(7);
    await settle();

    expect(fulfillment.grab).toHaveBeenCalledTimes(2);
  });

  /** One refusal explains itself; several need the count, or the last one reads as the only one. */
  it('summarises the chain on the request when more than one release was refused', async () => {
    const { service, fulfillment } = makeService({
      releases: [
        release({ indexerId: 9, indexerName: 'tracker', guid: 'one', score: 92 }),
        release({ indexerId: 5, indexerName: 'libgen', guid: 'two', score: 88 }),
      ],
    });
    fulfillment.grab
      .mockRejectedValueOnce(refusal('GRAB_SOURCE_REFUSED', 'tracker: the tracker answered 406'))
      .mockRejectedValueOnce(refusal('GRAB_SOURCE_REFUSED', 'libgen: the mirror answered 503'));

    service.considerRequest(7);
    await settle();

    const [, , reason] = fulfillment.setRequestStatus.mock.calls.at(-1) as [number, string, string];
    expect(reason).toContain('Tried 2 releases from 2 sources');
    expect(reason).toContain('libgen: the mirror answered 503');
  });

  /**
   * The one automation dead end that used to announce nothing. With the download client down,
   * every auto-approved request landed in `failed` with nobody told: its requester was never told
   * it existed and cannot open the picker, and the approvers had no reason to look.
   */
  it('tells the approvers when every release an auto-approved request tried was refused', async () => {
    const { service, notifier, fulfillment } = makeService({ releases: [release({ score: 92 })] });
    fulfillment.grab.mockRejectedValue(refusal('GRAB_CLIENT_REFUSED', 'the download client refused the torrent'));

    service.considerRequest(7, 'auto_approval');
    await settle();

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(7, 'failed', expect.any(String), null, FROM_SEARCHING);
    expect(notifier.notifyApprovers).toHaveBeenCalledTimes(1);
  });

  /** An approver watching the queue does not need telling about a request they just approved. */
  it('stays quiet about refused releases when an approver set the attempt off', async () => {
    const { service, notifier, fulfillment } = makeService({ releases: [release({ score: 92 })] });
    fulfillment.grab.mockRejectedValue(refusal('GRAB_CLIENT_REFUSED', 'the download client refused the torrent'));

    service.considerRequest(7);
    await settle();

    expect(notifier.notifyApprovers).not.toHaveBeenCalled();
  });

  /** A request an approver grabbed mid-pass keeps their download, and nobody is told it failed. */
  it('announces nothing when the failures could not be written', async () => {
    const { service, notifier, fulfillment } = makeService({ releases: [release({ score: 92 })] });
    fulfillment.grab.mockRejectedValue(refusal('GRAB_CLIENT_REFUSED', 'the download client refused the torrent'));
    fulfillment.setRequestStatus.mockImplementation((_id: number, status: string) => Promise.resolve(status !== 'failed'));

    service.considerRequest(7, 'auto_approval');
    await settle();

    expect(notifier.notifyApprovers).not.toHaveBeenCalled();
  });
});

describe('RequestAutomationService retry', () => {
  function fail(service: RequestAutomationService, events: { on: ReturnType<typeof vi.fn> }, downloadId = 11) {
    service.onModuleInit();
    const [event, listener] = events.on.mock.calls[0] as [string, (id: number) => void];
    expect(event).toBe(BOOK_REQUEST_DOWNLOAD_FAILED);
    listener(downloadId);
    return settle();
  }

  it('falls back to the next-best release the request has not already tried', async () => {
    const { service, events, fulfillment } = makeService({
      request: { status: 'failed' },
      releases: [release({ guid: 'tried-one' }), release({ guid: 'next-best', score: 88 })],
      tried: ['9:tried-one'],
      attempts: 1,
    });

    await fail(service, events);

    expect(fulfillment.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'next-best' }, null);
  });

  /**
   * A release an approver picked failed for a reason they chose. Swapping in the runner-up behind
   * their back is not automation, it is overruling them.
   */
  it('leaves a hand-picked release alone', async () => {
    const { service, events, fulfillment } = makeService({ request: { status: 'failed' }, download: { automated: false } });

    await fail(service, events);

    expect(fulfillment.grab).not.toHaveBeenCalled();
  });

  /**
   * And leaves the request exactly as the failure left it: "gave up after three attempts" would
   * overwrite what actually went wrong, which is the part an approver has to read.
   */
  it('stops once the attempt limit is spent, without rewriting the failure reason', async () => {
    const { service, events, fulfillment } = makeService({ request: { status: 'failed' }, attempts: 3, settings: { maxAutoGrabAttempts: 3 } });

    await fail(service, events);

    expect(fulfillment.grab).not.toHaveBeenCalled();
    expect(fulfillment.setRequestStatus).not.toHaveBeenCalled();
  });

  it('does not leave a request sitting at searching when the indexers could not be reached', async () => {
    const { service, events, fulfillment, releases } = makeService({ request: { status: 'failed' }, attempts: 1 });
    releases.search.mockRejectedValue(new Error('every indexer timed out'));

    await fail(service, events);

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(
      7,
      'failed',
      expect.stringContaining('every indexer timed out'),
      {
        code: 'SEARCH_FAILED',
        meta: { detail: 'every indexer timed out' },
      },
      FROM_SEARCHING,
    );
  });

  it('does not retry when the operator turned retries off', async () => {
    const { service, events, fulfillment, downloads } = makeService({ request: { status: 'failed' }, settings: { autoRetryEnabled: false } });

    await fail(service, events);

    expect(downloads.findById).not.toHaveBeenCalled();
    expect(fulfillment.grab).not.toHaveBeenCalled();
  });

  /** Turning auto-grab off mid-flight is an operator saying stop, retries included. */
  it('does not retry once unattended grabbing has been turned off', async () => {
    const { service, events, fulfillment } = makeService({ request: { status: 'failed' }, settings: { autoGrabEnabled: false } });

    await fail(service, events);

    expect(fulfillment.grab).not.toHaveBeenCalled();
  });

  it('returns a request to failed, not approved, when a retry finds nothing left to try', async () => {
    const { service, events, fulfillment } = makeService({
      request: { status: 'failed' },
      releases: [release({ guid: 'tried-one' })],
      tried: ['9:tried-one'],
      attempts: 1,
    });

    await fail(service, events);

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(
      7,
      'failed',
      expect.any(String),
      { code: 'ALL_TRIED', meta: undefined },
      FROM_SEARCHING,
    );
  });

  /**
   * "Nothing scored well enough" sends an approver off to add indexers they do not need. Having
   * already tried the only good release is a different problem and has to say so.
   */
  it('says the good releases are spent rather than claiming none were good enough', async () => {
    const { service, events, fulfillment } = makeService({
      request: { status: 'failed' },
      releases: [release({ guid: 'tried-one', score: 95 })],
      tried: ['9:tried-one'],
      attempts: 1,
    });

    await fail(service, events);

    const [, , reason] = fulfillment.setRequestStatus.mock.calls.at(-1) as [number, string, string];
    expect(reason).toContain('already been tried');
    expect(reason).not.toContain('scored');
  });

  it('still reports a genuinely weak field as nothing clearing the floor', async () => {
    const { service, events, fulfillment } = makeService({
      request: { status: 'failed' },
      releases: [release({ guid: 'weak', score: 20 })],
      attempts: 1,
    });

    await fail(service, events);

    expect(fulfillment.setRequestStatus).toHaveBeenLastCalledWith(
      7,
      'failed',
      expect.stringContaining('scored 80 or better'),
      {
        code: 'BELOW_SCORE_FLOOR',
        meta: { floor: 80 },
      },
      FROM_SEARCHING,
    );
  });
});

/**
 * The wanted list. Every other path here is set off by something a person did; without this one a
 * request declined for want of a good enough release, or for a book whose first release is posted
 * next month, sits at `approved` forever and looks like work somebody has already taken.
 */
describe('RequestAutomationService.sweepUnfulfilled', () => {
  const searchable = { autoSearchEnabled: true, autoGrabEnabled: true };

  it('searches again for every request that is due', async () => {
    const { service, requests, releases } = makeService({ settings: searchable, due: [{ id: 7 }, { id: 7 }] });

    await service.sweepUnfulfilled();

    expect(requests.findDueForResearch).toHaveBeenCalledWith(24, 60, 8, 7 * 24 * 60 * 60 * 1000, 25);
    expect(releases.search).toHaveBeenCalledTimes(2);
  });

  it('grabs a release that has since appeared', async () => {
    const { service, fulfillment } = makeService({ settings: searchable, due: [{ id: 7 }] });

    await service.sweepUnfulfilled();

    expect(fulfillment.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'release-1' }, null);
  });

  it('asks for nothing while the sweep is switched off', async () => {
    const { service, requests } = makeService({ settings: { autoSearchEnabled: false, autoGrabEnabled: true }, due: [{ id: 7 }] });

    await service.sweepUnfulfilled();

    expect(requests.findDueForResearch).not.toHaveBeenCalled();
  });

  /** A search has nothing to do with what it finds while auto-grab is off: it only costs traffic. */
  it('asks for nothing while unattended grabbing is off', async () => {
    const { service, requests } = makeService({ settings: { autoSearchEnabled: true, autoGrabEnabled: false }, due: [{ id: 7 }] });

    await service.sweepUnfulfilled();

    expect(requests.findDueForResearch).not.toHaveBeenCalled();
  });

  it('waits between requests rather than searching every tracker at once', async () => {
    const { service, searchDelay } = makeService({ settings: searchable, due: [{ id: 7 }, { id: 7 }, { id: 7 }] });

    await service.sweepUnfulfilled();

    // Between the requests, not before the first: three requests, two waits.
    expect(searchDelay.wait.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  /** The next tick reaches every row again, so one bad request must not end the sweep it is in. */
  it('carries on past a request that threw', async () => {
    const { service, requests, releases } = makeService({ settings: searchable, due: [{ id: 7 }, { id: 7 }] });
    requests.findById.mockRejectedValueOnce(new Error('the database went away'));

    await expect(service.sweepUnfulfilled()).resolves.toBeUndefined();
    expect(releases.search).toHaveBeenCalledTimes(1);
  });

  /** A sweep can outlast its own interval on a slow tracker, and two would search everything twice. */
  it('does not start a second sweep on top of one already running', async () => {
    const { service, requests } = makeService({ settings: searchable, due: [{ id: 7 }] });
    let release!: () => void;
    requests.findDueForResearch.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([]))));

    const first = service.sweepUnfulfilled();
    await service.sweepUnfulfilled();
    release();
    await first;

    expect(requests.findDueForResearch).toHaveBeenCalledTimes(1);
  });

  /**
   * A budget spent is a fact an approver already read off the row. Restating it nightly would
   * overwrite what actually went wrong and broadcast a change nobody made.
   */
  it('leaves a request whose attempt budget is spent exactly as it found it', async () => {
    const { service, fulfillment } = makeService({
      settings: { ...searchable, maxAutoGrabAttempts: 3 },
      attempts: 3,
      due: [{ id: 7 }],
    });

    await service.sweepUnfulfilled();

    expect(fulfillment.setRequestStatus).not.toHaveBeenCalled();
  });
});
