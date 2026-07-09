import { Logger } from '@nestjs/common';

import { AudiobookCoversCoverProvider } from './audiobookcovers-cover-provider';

const BLURHASH = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAAA'.repeat(3);

function resultBlock(id: string, size1280: string) {
  return `id:"${id}",blurhashUrl:"${BLURHASH}",source:"https://redd.it/abc",url:"https://images.audiobookcovers.com/original/${id}.png",jpeg:$R[9]={320:"https://images.audiobookcovers.com/jpeg/320/${id}.jpg",640:"https://images.audiobookcovers.com/jpeg/640/${id}.jpg",1280:"${size1280}"},webp:$R[10]={},primaryColor:$R[11]={},searchable:!0,distance:0.71,from_old_database:!0},`;
}

function pageHtml(ids: string[]) {
  const blocks = ids.map((id) => resultBlock(id, `https://images.audiobookcovers.com/jpeg/1280/${id}.jpg`)).join('');
  return `<script>$R[8]={images:$R[9]=[${blocks}]}</script>`;
}

describe('AudiobookCoversCoverProvider', () => {
  const originalFetch = global.fetch;
  const loggerWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: AudiobookCoversCoverProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AudiobookCoversCoverProvider();
    fetchMock = vi.fn();
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns no results when the search is not for an audiobook', async () => {
    await expect(provider.search({ title: 'Dune' })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no results when title is empty', async () => {
    await expect(provider.search({ title: '  ', isAudiobook: true })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses embedded search results into cover results', async () => {
    const html = pageHtml(['1c98a3d5-9c05-4157-81a5-558cbb5ea87a', 'b567a347-947e-4577-a48c-22236657acec']);
    fetchMock.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const results = await provider.search({ title: 'Dune', author: 'Frank Herbert', isAudiobook: true });

    expect(results).toEqual([
      {
        url: 'https://images.audiobookcovers.com/jpeg/1280/1c98a3d5-9c05-4157-81a5-558cbb5ea87a.jpg',
        sourceUrl: 'https://images.audiobookcovers.com/jpeg/1280/1c98a3d5-9c05-4157-81a5-558cbb5ea87a.jpg',
        previewUrl: 'https://images.audiobookcovers.com/jpeg/320/1c98a3d5-9c05-4157-81a5-558cbb5ea87a.jpg',
        width: 1280,
        height: 1280,
        source: 'AudiobookCovers',
      },
      {
        url: 'https://images.audiobookcovers.com/jpeg/1280/b567a347-947e-4577-a48c-22236657acec.jpg',
        sourceUrl: 'https://images.audiobookcovers.com/jpeg/1280/b567a347-947e-4577-a48c-22236657acec.jpg',
        previewUrl: 'https://images.audiobookcovers.com/jpeg/320/b567a347-947e-4577-a48c-22236657acec.jpg',
        width: 1280,
        height: 1280,
        source: 'AudiobookCovers',
      },
    ]);

    const [requestUrl] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/search');
    expect(parsed.searchParams.get('q')).toBe('Dune Frank Herbert');
  });

  it('deduplicates repeated ids in the response', async () => {
    const id = '1c98a3d5-9c05-4157-81a5-558cbb5ea87a';
    const html = pageHtml([id, id]);
    fetchMock.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const results = await provider.search({ title: 'Dune', isAudiobook: true });
    expect(results).toHaveLength(1);
  });

  it('returns no results when the request fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));

    await expect(provider.search({ title: 'Dune', isAudiobook: true })).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('Search failed with status 500'));
  });

  it('returns no results when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(provider.search({ title: 'Dune', isAudiobook: true })).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });
});
