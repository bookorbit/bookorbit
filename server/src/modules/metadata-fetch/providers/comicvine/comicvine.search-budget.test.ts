import { MetadataProviderKey, ProviderConfigurations } from '@bookorbit/types';
import { firstValueFrom, toArray } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fetchWithThrottleModule from '../../fetch-with-throttle';
import { MetadataFetchRepository } from '../../metadata-fetch.repository';
import { MetadataFetchService } from '../../metadata-fetch.service';
import { ProviderRegistry } from '../../provider-registry';
import { ProviderThrottleTracker } from '../../provider-throttle.tracker';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { PROVIDER_BUDGETS_MS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { ComicVineClient } from './comicvine.client';
import { ComicVineProvider } from './comicvine.provider';
import { ComicVineIssue, ComicVineVolume } from './comicvine.types';

vi.mock('../../fetch-with-throttle', () => ({ fetchWithThrottle: vi.fn() }));

/**
 * Regression cover for the ComicVine search collapsing into "No results found" (issue #1039).
 * Latencies are the ones measured against the live API in that report: the volume search is fast,
 * every issue lookup is slow, and the provider has 15s for the whole search.
 */
const VOLUME_SEARCH_MS = 570;
const ISSUE_PROBE_MS = 3_500;
const ISSUE_DETAIL_MS = 2_000;

const ASM_2022 = 142577;
const ASM_2018 = 84213;
const ASM_1963 = 1218;

const providerConfig: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: false },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: false },
  itunes: { enabled: false, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: true, apiKey: 'test-key' },
  ranobedb: { enabled: false },
  kobo: { enabled: false, country: 'us', language: 'en' },
  lubimyczytac: { enabled: false },
};

function volume(id: number, name: string, startYear: string, countOfIssues: number): ComicVineVolume {
  return {
    id,
    name,
    start_year: startYear,
    count_of_issues: countOfIssues,
    description: null,
    deck: null,
    image: null,
    publisher: null,
    site_detail_url: null,
  };
}

function issue(id: number, volumeId: number, volumeName: string, issueNumber: string, options: { credits?: boolean } = {}): ComicVineIssue {
  const credited = options.credits ?? true;
  return {
    id,
    name: `Amazing Spider-Man #${issueNumber}`,
    issue_number: issueNumber,
    cover_date: '2022-11-01',
    store_date: null,
    description: null,
    deck: null,
    image: null,
    volume: { id: volumeId, name: volumeName },
    site_detail_url: null,
    person_credits: credited ? [{ id: 1, name: 'Zeb Wells', role: 'writer' }] : [],
    character_credits: [],
    team_credits: [],
    story_arc_credits: [],
    location_credits: [],
  };
}

// What `filter=name:Amazing Spider-Man` actually returns: three runs plus the spin-offs and
// annuals the substring match drags in.
const AMAZING_SPIDER_MAN_VOLUMES: ComicVineVolume[] = [
  volume(90160, 'The Amazing Spider-Man Annual', '2018', 5),
  volume(ASM_1963, 'The Amazing Spider-Man', '1963', 441),
  volume(88985, 'Amazing Spider-Man: Renew Your Vows', '2016', 23),
  volume(ASM_2022, 'The Amazing Spider-Man', '2022', 93),
  volume(38536, 'Amazing Spider-Man Family', '2008', 8),
  volume(ASM_2018, 'The Amazing Spider-Man', '2018', 74),
  volume(49036, 'Amazing Spider-Man: Extra!', '2008', 3),
  volume(76473, 'The Amazing Spider-Man: Epic Collection', '2013', 24),
];

function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error('This operation was aborted');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function okResponse(results: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve({ status_code: 1, error: 'OK', results }) } as Response;
}

function throttledResponse(): Response {
  return { ok: false, status: 420 } as Response;
}

interface HarnessOptions {
  volumes?: ComicVineVolume[];
  // Issues the /issues/ endpoint holds, keyed "<volumeId>#<issueNumber>".
  issues?: Record<string, ComicVineIssue[]>;
  generalSearchResults?: ComicVineIssue[];
  issueDetails?: Record<string, ComicVineIssue>;
  issueDetailMs?: number;
  // Volumes and issue details ComicVine answers with HTTP 420, its throttle response.
  throttledVolumeIds?: number[];
  throttledDetailIds?: string[];
}

interface Harness {
  provider: ComicVineProvider;
  service: MetadataFetchService;
  throttleTracker: ProviderThrottleTracker;
  requestUrls: URL[];
  probedVolumeIds: number[];
  detailIssueIds: string[];
  abortedPaths: string[];
}

function buildHarness(options: HarnessOptions = {}): Harness {
  const volumes = options.volumes ?? AMAZING_SPIDER_MAN_VOLUMES;
  const issues = options.issues ?? {};
  const requestUrls: URL[] = [];
  const probedVolumeIds: number[] = [];
  const detailIssueIds: string[] = [];
  const abortedPaths: string[] = [];
  const detailMs = options.issueDetailMs ?? ISSUE_DETAIL_MS;

  vi.mocked(fetchWithThrottleModule.fetchWithThrottle).mockImplementation(async (url, init) => {
    const target = new URL(String(url));
    const signal = init?.signal ?? undefined;
    requestUrls.push(target);

    const respondAfter = async (ms: number, response: () => Response): Promise<Response> => {
      try {
        await abortableDelay(ms, signal);
      } catch (err) {
        abortedPaths.push(target.pathname);
        throw err;
      }
      return response();
    };

    if (target.pathname.endsWith('/volumes/')) {
      return respondAfter(VOLUME_SEARCH_MS, () => okResponse(volumes));
    }

    if (target.pathname.endsWith('/search/')) {
      return respondAfter(VOLUME_SEARCH_MS, () => okResponse(options.generalSearchResults ?? []));
    }

    if (target.pathname.endsWith('/issues/')) {
      const filter = target.searchParams.get('filter') ?? '';
      const volumeId = Number(/volume:(\d+)/.exec(filter)?.[1]);
      const issueNumber = /issue_number:([^,]+)/.exec(filter)?.[1] ?? '';
      probedVolumeIds.push(volumeId);
      return respondAfter(ISSUE_PROBE_MS, () =>
        options.throttledVolumeIds?.includes(volumeId) ? throttledResponse() : okResponse(issues[`${volumeId}#${issueNumber}`] ?? []),
      );
    }

    const issueId = /\/issue\/4000-(\d+)\//.exec(target.pathname)?.[1] ?? '';
    detailIssueIds.push(issueId);
    return respondAfter(detailMs, () =>
      options.throttledDetailIds?.includes(issueId) ? throttledResponse() : okResponse(options.issueDetails?.[issueId] ?? null),
    );
  });

  const throttleTracker = new ProviderThrottleTracker();
  vi.spyOn(throttleTracker, 'record');
  const provider = new ComicVineProvider(
    new ComicVineClient(),
    { getConfig: () => Promise.resolve(providerConfig) } as unknown as ProviderConfigService,
    throttleTracker,
  );
  const service = new MetadataFetchService(new ProviderRegistry([provider]), new ProviderThrottleTracker(), {} as MetadataFetchRepository);

  return { provider, service, throttleTracker, requestUrls, probedVolumeIds, detailIssueIds, abortedPaths };
}

async function runToCompletion<T>(work: Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const startedAt = Date.now();
  let settledAt = startedAt;
  const tracked = work.then((value) => {
    settledAt = Date.now();
    return value;
  });
  await vi.advanceTimersByTimeAsync(120_000);
  return { value: await tracked, elapsedMs: settledAt - startedAt };
}

describe('ComicVine search budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:51:23.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps its own budget under the timeout that aborts it', () => {
    expect(PROVIDER_BUDGETS_MS.COMICVINE_SEARCH).toBeLessThan(PROVIDER_TIMEOUT_MS.SCRAPE);
  });

  it('finds the reported issue instead of timing out', async () => {
    const harness = buildHarness({
      issues: {
        [`${ASM_2022}#67`]: [issue(900_001, ASM_2022, 'The Amazing Spider-Man', '67')],
        [`${ASM_1963}#67`]: [issue(900_002, ASM_1963, 'The Amazing Spider-Man', '67')],
      },
    });

    const { value: candidates, elapsedMs } = await runToCompletion(
      firstValueFrom(
        harness.service
          .search(
            // What the controller builds for the reported book: the typed series name plus the
            // series and issue already parsed into book_metadata.
            { title: 'Amazing Spider-Man', seriesName: 'Amazing Spider-Man', seriesIndex: 67 },
            [MetadataProviderKey.COMICVINE],
          )
          .pipe(toArray()),
      ),
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(PROVIDER_TIMEOUT_MS.SCRAPE);
  });

  it('spends its requests on the runs that can hold the issue, not on annuals and collections', async () => {
    const harness = buildHarness({
      issues: { [`${ASM_2022}#67`]: [issue(900_001, ASM_2022, 'The Amazing Spider-Man', '67')] },
    });

    await runToCompletion(harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }));

    expect(harness.probedVolumeIds).toEqual([ASM_2022, ASM_2018, ASM_1963]);
  });

  it('offers every run that has the issue, most recent first, each carrying its own issue count', async () => {
    const harness = buildHarness({
      issues: {
        [`${ASM_2022}#67`]: [issue(900_001, ASM_2022, 'The Amazing Spider-Man', '67')],
        [`${ASM_1963}#67`]: [issue(900_002, ASM_1963, 'The Amazing Spider-Man', '67')],
      },
    });

    const { value: candidates } = await runToCompletion(
      harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }),
    );

    expect(candidates.map((c) => c.providerId)).toEqual(['900001', '900002']);
    expect(candidates.map((c) => c.seriesTotalBooks)).toEqual([93, 441]);
  });

  it('reaches a run that ranking cannot promote, where probing one at a time ran out of time', async () => {
    // Twenty volumes the ranking cannot tell apart, with the match sitting sixth: the case the
    // report hit, where the old serial probe never got past the fourth candidate.
    const indistinguishable = Array.from({ length: 20 }, (_, i) => volume(i === 5 ? ASM_2022 : 1000 + i, 'The Amazing Spider-Man', '2022', 93));
    const harness = buildHarness({
      volumes: indistinguishable,
      issues: { [`${ASM_2022}#67`]: [issue(900_001, ASM_2022, 'The Amazing Spider-Man', '67')] },
    });

    const { value: candidates, elapsedMs } = await runToCompletion(
      harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }),
    );

    expect(candidates).toHaveLength(1);
    expect(harness.probedVolumeIds).toContain(ASM_2022);
    expect(elapsedMs).toBeLessThan(PROVIDER_TIMEOUT_MS.SCRAPE);
  });

  it('gives up on a series ComicVine does not carry without spending the whole budget', async () => {
    const harness = buildHarness({ issues: {} });

    const { value: candidates, elapsedMs } = await runToCompletion(
      harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }),
    );

    expect(candidates).toEqual([]);
    expect(harness.probedVolumeIds.length).toBeLessThanOrEqual(8);
    expect(elapsedMs).toBeLessThan(PROVIDER_TIMEOUT_MS.SCRAPE);
  });

  it('strips the zero padding a comic filename adds to the issue number', async () => {
    const harness = buildHarness({
      issues: { [`${ASM_2022}#67`]: [issue(900_001, ASM_2022, 'The Amazing Spider-Man', '67')] },
    });

    // The SSE controller normalizes "#067" itself; the background orchestrator does not, so the
    // provider has to.
    const { value: candidates } = await runToCompletion(harness.provider.search({ title: 'Amazing Spider-Man #067' }));

    const probe = harness.requestUrls.find((url) => url.pathname.endsWith('/issues/'));
    expect(probe?.searchParams.get('filter')).toBe(`volume:${ASM_2022},issue_number:67`);
    expect(candidates).toHaveLength(1);
  });

  it('stops enriching when the budget runs out but keeps the candidates it found', async () => {
    const uncredited = Array.from({ length: 5 }, (_, i) => issue(900_100 + i, ASM_2022, 'The Amazing Spider-Man', '67', { credits: false }));
    const harness = buildHarness({
      issues: { [`${ASM_2022}#67`]: uncredited },
      issueDetails: Object.fromEntries(
        uncredited.map((i) => [String(i.id), { ...i, person_credits: [{ id: 1, name: 'Zeb Wells', role: 'writer' }] }]),
      ),
    });

    const { value: candidates, elapsedMs } = await runToCompletion(
      harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }),
    );

    expect(candidates).toHaveLength(uncredited.length);
    expect(harness.detailIssueIds.length).toBeGreaterThan(0);
    expect(harness.detailIssueIds.length).toBeLessThan(uncredited.length);
    expect(candidates.at(-1)?.authors).toEqual([]);
    expect(elapsedMs).toBeLessThan(PROVIDER_TIMEOUT_MS.SCRAPE);
  });

  it('cuts off a detail lookup that would outlive the search, keeping the candidate', async () => {
    const uncredited = [issue(900_100, ASM_2022, 'The Amazing Spider-Man', '67', { credits: false })];
    const harness = buildHarness({
      issues: { [`${ASM_2022}#67`]: uncredited },
      // Long enough that, left to run, it would cross the hard timeout and take everything with it.
      issueDetailMs: 12_000,
      issueDetails: { '900100': { ...uncredited[0], person_credits: [{ id: 1, name: 'Zeb Wells', role: 'writer' }] } },
    });

    const { value: candidates, elapsedMs } = await runToCompletion(
      harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }),
    );

    expect(harness.abortedPaths).toEqual(['/api/issue/4000-900100/']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].authors).toEqual([]);
    expect(elapsedMs).toBeLessThan(PROVIDER_TIMEOUT_MS.SCRAPE);
  });

  it('keeps what a wave found when one of its probes is throttled', async () => {
    const harness = buildHarness({
      issues: { [`${ASM_2022}#67`]: [issue(900_001, ASM_2022, 'The Amazing Spider-Man', '67')] },
      throttledVolumeIds: [ASM_2018],
    });

    const { value: candidates } = await runToCompletion(
      harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }),
    );

    expect(candidates.map((c) => c.providerId)).toEqual(['900001']);
    expect(harness.throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, expect.anything());
  });

  it('keeps the candidate when the detail lookup behind it is throttled', async () => {
    const uncredited = [
      issue(900_100, ASM_2022, 'The Amazing Spider-Man', '67', { credits: false }),
      issue(900_101, ASM_2022, 'The Amazing Spider-Man', '67', { credits: false }),
    ];
    const harness = buildHarness({
      issues: { [`${ASM_2022}#67`]: uncredited },
      throttledDetailIds: ['900100'],
    });

    const { value: candidates } = await runToCompletion(
      harness.provider.search({ seriesName: 'Amazing Spider-Man', seriesIndex: 67, title: 'Amazing Spider-Man' }),
    );

    expect(candidates.map((c) => c.providerId)).toEqual(['900100', '900101']);
    expect(harness.throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, expect.anything());
    // Throttled once, the run stops asking rather than spending the rest of the window on refusals.
    expect(harness.detailIssueIds).toEqual(['900100']);
  });

  it('falls back to the general issue search for a comic with no parsed series', async () => {
    const harness = buildHarness({
      generalSearchResults: [issue(900_001, ASM_2022, 'The Amazing Spider-Man', '67')],
    });

    const { value: candidates } = await runToCompletion(harness.provider.search({ title: 'The Amazing Spider-Man (2022) Volume 06 Issue 067' }));

    expect(harness.requestUrls[0].pathname).toBe('/api/search/');
    expect(harness.probedVolumeIds).toEqual([]);
    expect(candidates).toHaveLength(1);
  });
});
