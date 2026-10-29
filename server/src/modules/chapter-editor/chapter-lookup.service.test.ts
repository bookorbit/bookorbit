import { HttpException, Logger } from '@nestjs/common';
import type { Mock } from 'vitest';
import { BOOK_CHAPTERS_ERROR_CODES, type AudibleRegion } from '@bookorbit/types';

import { audibleRegionForDomain, ChapterLookupService } from './chapter-lookup.service';

const ASIN = 'B0TESTASIN';

/** Audible's content metadata answer with `chapter_titles_type=Tree`: parts nest their chapters. */
const AUDIBLE_TREE = {
  content_metadata: {
    chapter_info: {
      brandIntroDurationMs: 2_043,
      brandOutroDurationMs: 5_061,
      is_accurate: true,
      runtime_length_ms: 3_600_000,
      runtime_length_sec: 3_600,
      chapters: [
        { length_ms: 25_000, start_offset_ms: 0, start_offset_sec: 0, title: 'Opening Credits' },
        {
          length_ms: 1_000,
          start_offset_ms: 25_000,
          start_offset_sec: 25,
          title: ' Part One ',
          chapters: [
            { length_ms: 1_000_000, start_offset_ms: 26_000, start_offset_sec: 26, title: 'Chapter 1' },
            { length_ms: 1_200_000, start_offset_ms: 1_026_000, start_offset_sec: 1_026, title: 'Chapter 2' },
          ],
        },
        { length_ms: 10_000, title: 'No start, so not a chapter' },
        { start_offset_ms: 3_590_000, title: 'End Credits' },
      ],
    },
  },
  response_groups: ['always-returned', 'chapter_info'],
};

const AUDNEXUS_FLAT = {
  asin: ASIN,
  brandIntroDurationMs: 1_000,
  brandOutroDurationMs: 2_000,
  isAccurate: false,
  region: 'uk',
  runtimeLengthMs: 7_200_000,
  runtimeLengthSec: 7_200,
  chapters: [
    { lengthMs: 60_000, startOffsetMs: 0, startOffsetSec: 0, title: 'Opening' },
    { lengthMs: 7_140_000, startOffsetMs: 60_000, startOffsetSec: 60, title: 'Chapter 1' },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function status(code: number): Response {
  return new Response(null, { status: code });
}

async function refusal(run: Promise<unknown>): Promise<{ status: number; errorCode?: string }> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  const exception = error as HttpException;
  return { status: exception.getStatus(), errorCode: (exception.getResponse() as { errorCode?: string }).errorCode };
}

describe('ChapterLookupService', () => {
  let fetchMock: Mock<typeof fetch>;
  let service: ChapterLookupService;

  const requestedUrls = () => fetchMock.mock.calls.map(([url]) => url as string);

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new ChapterLookupService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads Audible chapter tree with parts, brand timings, runtime and accuracy', async () => {
    fetchMock.mockResolvedValueOnce(json(AUDIBLE_TREE));

    const result = await service.lookup(ASIN, 'us');

    expect(result).toEqual({
      provider: 'audible',
      asin: ASIN,
      region: 'us',
      runtimeMs: 3_600_000,
      brandIntroMs: 2_043,
      brandOutroMs: 5_061,
      isAccurate: true,
      chapters: [
        { title: 'Opening Credits', startMs: 0, lengthMs: 25_000, children: [] },
        {
          title: 'Part One',
          startMs: 25_000,
          lengthMs: 1_000,
          children: [
            { title: 'Chapter 1', startMs: 26_000, lengthMs: 1_000_000, children: [] },
            { title: 'Chapter 2', startMs: 1_026_000, lengthMs: 1_200_000, children: [] },
          ],
        },
        { title: 'End Credits', startMs: 3_590_000, lengthMs: null, children: [] },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.audible.com/1.0/content/${ASIN}/metadata?response_groups=chapter_info&chapter_titles_type=Tree`);
    expect(init).toMatchObject({ redirect: 'error', headers: { Accept: 'application/json' } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('defaults brand timings to zero and accuracy to unknown when Audible leaves them out', async () => {
    fetchMock.mockResolvedValueOnce(json({ content_metadata: { chapter_info: { chapters: [{ start_offset_ms: 0, title: 'Only' }] } } }));

    await expect(service.lookup(ASIN, 'us')).resolves.toMatchObject({ runtimeMs: null, brandIntroMs: 0, brandOutroMs: 0, isAccurate: null });
  });

  it.each<[AudibleRegion, string]>([
    ['uk', 'https://api.audible.co.uk'],
    ['jp', 'https://api.audible.co.jp'],
    ['au', 'https://api.audible.com.au'],
    ['de', 'https://api.audible.de'],
  ])('asks the %s storefront at %s', async (region, origin) => {
    fetchMock.mockResolvedValueOnce(json(AUDIBLE_TREE));

    await expect(service.lookup(ASIN, region)).resolves.toMatchObject({ provider: 'audible', region });
    expect(requestedUrls()[0]).toMatch(new RegExp(`^${origin.replace(/\./g, '\\.')}/1\\.0/content/${ASIN}/metadata\\?`));
  });

  it.each([
    { name: 'answers 404', audible: () => Promise.resolve(status(404)) },
    { name: 'has no chapter info', audible: () => Promise.resolve(json({ content_metadata: {} })) },
    { name: 'cannot be reached', audible: () => Promise.reject(new TypeError('fetch failed')) },
    { name: 'answers 503', audible: () => Promise.resolve(status(503)) },
    { name: 'answers something other than JSON', audible: () => Promise.resolve(new Response('<html>', { status: 200 })) },
  ])('falls back to Audnexus when Audible $name', async ({ audible }) => {
    fetchMock.mockImplementationOnce(audible).mockResolvedValueOnce(json(AUDNEXUS_FLAT));

    const result = await service.lookup(ASIN, 'uk');

    expect(requestedUrls()[1]).toBe(`https://api.audnex.us/books/${ASIN}/chapters?region=uk`);
    expect(result).toEqual({
      provider: 'audnexus',
      asin: ASIN,
      region: 'uk',
      runtimeMs: 7_200_000,
      brandIntroMs: 1_000,
      brandOutroMs: 2_000,
      isAccurate: false,
      chapters: [
        { title: 'Opening', startMs: 0, lengthMs: 60_000, children: [] },
        { title: 'Chapter 1', startMs: 60_000, lengthMs: 7_140_000, children: [] },
      ],
    });
  });

  it('keeps an answer per region and ASIN for six hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
    fetchMock.mockImplementation(() => Promise.resolve(json(AUDIBLE_TREE)));

    const first = await service.lookup(ASIN, 'us');
    await expect(service.lookup(ASIN, 'us')).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await service.lookup(ASIN, 'uk');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-10-01T06:00:01.000Z'));
    await service.lookup(ASIN, 'us');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('answers 404 when neither source knows the ASIN, without caching the miss', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(status(404)));

    await expect(refusal(service.lookup(ASIN, 'us'))).resolves.toEqual({ status: 404, errorCode: BOOK_CHAPTERS_ERROR_CODES.lookupNotFound });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await refusal(service.lookup(ASIN, 'us'));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    { name: 'both sources fail', audible: () => Promise.reject(new TypeError('fetch failed')), audnexus: () => Promise.resolve(status(502)) },
    { name: 'Audible fails and Audnexus has nothing', audible: () => Promise.resolve(status(500)), audnexus: () => Promise.resolve(status(404)) },
    {
      name: 'Audible has nothing and Audnexus fails',
      audible: () => Promise.resolve(status(404)),
      audnexus: () => Promise.reject(new Error('timeout')),
    },
  ])('answers 502 when $name', async ({ audible, audnexus }) => {
    fetchMock.mockImplementationOnce(audible).mockImplementationOnce(audnexus);

    await expect(refusal(service.lookup(ASIN, 'us'))).resolves.toEqual({ status: 502, errorCode: BOOK_CHAPTERS_ERROR_CODES.lookupUnavailable });
  });
});

describe('audibleRegionForDomain', () => {
  it.each([
    ['com', 'us'],
    ['co.uk', 'uk'],
    ['audible.co.uk', 'uk'],
    ['co.jp', 'jp'],
    ['audible.com.au', 'au'],
    [' Audible.DE ', 'de'],
    ['https://api.audible.fr/store', 'fr'],
    ['in', 'in'],
  ])('maps %s to %s', (domain, region) => {
    expect(audibleRegionForDomain(domain)).toBe(region);
  });

  it.each([null, undefined, '', 'audible.nl', 'example.com'])('falls back to us for %s', (domain) => {
    expect(audibleRegionForDomain(domain)).toBe('us');
  });
});
