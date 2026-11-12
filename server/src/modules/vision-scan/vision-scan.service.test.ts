import { HttpException, Logger } from '@nestjs/common';
import sharp from 'sharp';

import type { BookCard, ShelfMatchRequest, VisualMatch } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { AiClient } from '../ai/ai-client.service';
import { AiError, type AiRequest, type AiResult } from '../ai/ai-client.types';
import { defaultFeatureSettings, emptySlot, type AiSettingsService } from '../ai/ai-settings.service';
import type { VisualMatchService } from '../visual-match/visual-match.service';
import { VISION_SCAN_TIMEOUT_MS, VisionScanService } from './vision-scan.service';

const user = { id: 7 } as RequestUser;

async function photo(width: number, height: number, options: { orientation?: number; format?: 'jpeg' | 'png' | 'gif' } = {}): Promise<string> {
  let image = sharp({ create: { width, height, channels: 3, background: '#887766' } });
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  const format = options.format ?? 'jpeg';
  const bytes = await (format === 'png' ? image.png() : format === 'gif' ? image.gif() : image.jpeg()).toBuffer();
  return bytes.toString('base64');
}

function match(id: number, title: string): VisualMatch {
  return { book: { id, title } as BookCard, confidence: 0.9, matchedBy: 'text', highlightCount: 0 };
}

function reply(json: unknown, finish: AiResult['finish'] = 'stop'): AiResult {
  return { text: JSON.stringify(json), json, finish, usage: { input: 900, output: 80 }, model: 'vision-model' };
}

function setup(options: { enabled?: boolean; slot?: boolean } = {}) {
  const complete = vi.fn<(request: AiRequest) => Promise<AiResult>>();
  const matchShelf = vi.fn((_user: RequestUser, request: ShelfMatchRequest) =>
    Promise.resolve({
      results: request.spines.map((spine) => ({
        id: spine.id,
        matches: spine.lines[0] === 'Dracula' ? [match(11, 'Dracula')] : [],
        author: null,
      })),
    }),
  );
  const settings = {
    features: () =>
      Promise.resolve({
        'story-guides': defaultFeatureSettings('story-guides'),
        'vision-scan': { ...defaultFeatureSettings('vision-scan'), enabled: options.enabled ?? true },
      }),
    slots: () =>
      Promise.resolve({
        fast: emptySlot(),
        careful: emptySlot(),
        vision: options.slot === false ? emptySlot() : { ...emptySlot(), connectionId: 1, model: 'vision-model' },
      }),
  };
  const service = new VisionScanService(
    { complete } as unknown as AiClient,
    settings as unknown as AiSettingsService,
    { matchShelf } as unknown as VisualMatchService,
  );
  return { service, complete, matchShelf };
}

async function scanError(promise: Promise<unknown>): Promise<{ status: number; errorCode?: string }> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { status: error.getStatus(), errorCode: (error.getResponse() as { errorCode?: string }).errorCode };
  }
  throw new Error('expected the scan to fail');
}

describe('VisionScanService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads the books in a shelf photo and matches each to the library', async () => {
    const { service, complete, matchShelf } = setup();
    complete.mockResolvedValue(
      reply({
        books: [
          { title: '  Moby-Dick ', author: 'Herman Melville', box: [100, 50, 200, 950] },
          { title: 'Dracula', author: null, box: null },
          { title: '', author: 'Nobody', box: null },
        ],
      }),
    );

    const result = await service.scan(user, { kind: 'shelf', image: await photo(1200, 800) });

    expect(result).toEqual({
      kind: 'shelf',
      books: [
        { id: '0', title: 'Moby-Dick', author: 'Herman Melville', box: { x: 0.1, y: 0.05, width: 0.1, height: 0.9 }, matches: [] },
        { id: '1', title: 'Dracula', author: null, box: null, matches: [match(11, 'Dracula')] },
      ],
    });
    expect(matchShelf).toHaveBeenCalledWith(user, {
      spines: [
        { id: '0', lines: ['Moby-Dick', 'Herman Melville'] },
        { id: '1', lines: ['Dracula'] },
      ],
    });
    const request = complete.mock.calls[0][0];
    expect(request).toMatchObject({ feature: 'vision-scan', slot: 'vision', images: [{ mediaType: 'image/jpeg', width: 1200, height: 800 }] });
    expect(request.user).toContain('shelf');
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it('turns the photo upright, scales it to the kind, and sends no metadata', async () => {
    const { service, complete } = setup();
    complete.mockResolvedValue(reply({ books: [] }));

    await service.scan(user, { kind: 'cover', image: await photo(4000, 3000, { orientation: 6 }) });

    const [image] = complete.mock.calls[0][0].images ?? [];
    expect([image.width, image.height]).toEqual([1152, 1536]);
    const metadata = await sharp(Buffer.from(image.data, 'base64')).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 1152, height: 1536 });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it('skips matching when nothing was readable', async () => {
    const { service, complete, matchShelf } = setup();
    complete.mockResolvedValue(reply({ books: [] }));
    await expect(service.scan(user, { kind: 'cover', image: await photo(600, 900) })).resolves.toEqual({ kind: 'cover', books: [] });
    expect(matchShelf).not.toHaveBeenCalled();
  });

  it.each([
    ['text that is not an image', Buffer.from('not a photo at all').toString('base64')],
    ['a GIF', 'gif'],
    ['a photo too small to read', 'tiny'],
  ])('refuses %s without calling the model', async (_label, input) => {
    const { service, complete } = setup();
    const image = input === 'gif' ? await photo(400, 400, { format: 'gif' }) : input === 'tiny' ? await photo(40, 300) : input;
    await expect(scanError(service.scan(user, { kind: 'cover', image }))).resolves.toEqual({ status: 400, errorCode: 'VISION_SCAN_IMAGE_INVALID' });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    ['off', 403, 'VISION_SCAN_OFF'],
    ['slot-empty', 403, 'VISION_SCAN_OFF'],
    ['budget', 403, 'VISION_SCAN_BUDGET'],
    ['provider-down', 502, 'VISION_SCAN_PROVIDER'],
    ['invalid-json', 502, 'VISION_SCAN_PROVIDER'],
  ] as const)('answers the AI error %s with %i %s', async (code, status, errorCode) => {
    const { service, complete } = setup();
    complete.mockRejectedValue(new AiError(code, 'failed'));
    await expect(scanError(service.scan(user, { kind: 'shelf', image: await photo(800, 600) }))).resolves.toEqual({ status, errorCode });
  });

  it('says when the model declined the photo', async () => {
    const { service, complete } = setup();
    complete.mockResolvedValue(reply({ books: [] }, 'refused'));
    await expect(scanError(service.scan(user, { kind: 'shelf', image: await photo(800, 600) }))).resolves.toEqual({
      status: 422,
      errorCode: 'VISION_SCAN_REFUSED',
    });
  });

  it('gives up after its time limit with a timeout code', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    const { service, complete } = setup();
    complete.mockRejectedValue(new AiError('cancelled', 'The request was cancelled'));
    await expect(scanError(service.scan(user, { kind: 'shelf', image: await photo(800, 600) }))).resolves.toEqual({
      status: 504,
      errorCode: 'VISION_SCAN_TIMEOUT',
    });
    expect(timeout).toHaveBeenCalledWith(VISION_SCAN_TIMEOUT_MS);
  });

  it('stops the model call when the app drops the request', async () => {
    const { service, complete } = setup();
    complete.mockImplementation((request) => {
      expect(request.signal?.aborted).toBe(true);
      return Promise.reject(new AiError('cancelled', 'The request was cancelled'));
    });
    const gone = new AbortController();
    gone.abort();
    await expect(service.scan(user, { kind: 'shelf', image: await photo(800, 600) }, gone.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('is on in app-info only with the feature on and the Vision slot set', async () => {
    await expect(setup().service.appInfo()).resolves.toEqual({ enabled: true });
    await expect(setup({ enabled: false }).service.appInfo()).resolves.toEqual({ enabled: false });
    await expect(setup({ slot: false }).service.appInfo()).resolves.toEqual({ enabled: false });
  });
});
