import { ConfigService } from '@nestjs/config';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { ReleaseNotesService } from './release-notes.service';

function ghRelease(tag: string, highlights: boolean) {
  return {
    tag_name: tag,
    name: tag,
    published_at: '2026-06-14T00:00:00Z',
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    draft: false,
    body: highlights ? `## Highlights\n- **${tag} thing** - did stuff.\n\n### Features\n- f` : '### Features\n- f',
  };
}

function makeService(releases: unknown[], enabled = true, currentVersion?: string) {
  const config = {
    get: (key: string) => {
      if (key === 'app.githubReleasesRepo') return 'o/r';
      if (key === 'app.version') return currentVersion;
      return undefined;
    },
  } as unknown as ConfigService;
  const appSettings = { isUpdateCheckEnabled: vi.fn().mockResolvedValue(enabled) } as unknown as AppSettingsService;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(releases) }));
  return new ReleaseNotesService(config, appSettings);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReleaseNotesService.getSince', () => {
  it('returns only versions newer than the baseline that have highlights, newest first', async () => {
    const service = makeService([ghRelease('v1.2.0', true), ghRelease('v1.1.0', true), ghRelease('v1.0.0', true)]);
    const res = await service.getSince('v1.0.0');
    expect(res.releases.map((r) => r.version)).toEqual(['v1.2.0', 'v1.1.0']);
    expect(res.hasMore).toBe(false);
  });

  it('excludes releases without a Highlights section', async () => {
    const service = makeService([ghRelease('v1.2.0', false), ghRelease('v1.1.0', true)]);
    const res = await service.getSince('v1.0.0');
    expect(res.releases.map((r) => r.version)).toEqual(['v1.1.0']);
  });

  it('caps the cumulative list and flags hasMore', async () => {
    const service = makeService([
      ghRelease('v1.5.0', true),
      ghRelease('v1.4.0', true),
      ghRelease('v1.3.0', true),
      ghRelease('v1.2.0', true),
      ghRelease('v1.1.0', true),
    ]);
    const res = await service.getSince('v1.0.0');
    expect(res.releases).toHaveLength(4);
    expect(res.hasMore).toBe(true);
  });

  it('never announces versions newer than the running build', async () => {
    const service = makeService([ghRelease('v1.3.0', true), ghRelease('v1.2.0', true), ghRelease('v1.1.0', true)], true, 'v1.2.0');
    const res = await service.getSince('v1.0.0');
    expect(res.releases.map((r) => r.version)).toEqual(['v1.2.0', 'v1.1.0']);
  });

  it('returns an empty list when update checks are disabled', async () => {
    const service = makeService([ghRelease('v1.2.0', true)], false);
    const res = await service.getSince('v1.0.0');
    expect(res.releases).toEqual([]);
  });

  it('reclassifies extensionless GitHub media as video via a content-type probe, once per unique URL', async () => {
    const sharedUrl = 'https://github.com/user-attachments/assets/abc';
    const releases = [
      {
        tag_name: 'v1.2.0',
        name: 'v1.2.0',
        published_at: '2026-06-14T00:00:00Z',
        html_url: 'https://github.com/o/r/releases/tag/v1.2.0',
        draft: false,
        body: `## Highlights\n- **Demo** - watch this.\n  ![](${sharedUrl})\n- **Again** - same clip.\n  ![](${sharedUrl})`,
      },
    ];
    const config = {
      get: (key: string) => (key === 'app.githubReleasesRepo' ? 'o/r' : key === 'app.githubReleasesToken' ? 'tkn' : undefined),
    } as unknown as ConfigService;
    const appSettings = { isUpdateCheckEnabled: vi.fn().mockResolvedValue(true) } as unknown as AppSettingsService;
    const fetchMock = vi.fn((url: string) =>
      new URL(url).hostname === 'api.github.com'
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(releases) })
        : Promise.resolve({ headers: { get: () => 'video/mp4' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new ReleaseNotesService(config, appSettings);
    const highlights = (await service.getSince('v1.0.0')).releases[0].highlights;
    expect(highlights[0].media).toEqual([{ url: sharedUrl, type: 'video' }]);
    expect(highlights[1].media).toEqual([{ url: sharedUrl, type: 'video' }]);
    const probeCalls = fetchMock.mock.calls.filter(([u]) => new URL(String(u)).hostname !== 'api.github.com');
    expect(probeCalls).toHaveLength(1);
  });

  it('ignores releases whose tag is not a clean vX.Y.Z (extra segments / trailing garbage)', async () => {
    const service = makeService([ghRelease('v1.2.0.4', true), ghRelease('v1.2.0-nope-extra', true), ghRelease('v1.1.0', true)]);
    const res = await service.getSince('v1.0.0');
    expect(res.releases.map((r) => r.version)).toEqual(['v1.1.0']);
  });

  it('strips the Highlights section from the changelog body', async () => {
    const service = makeService([ghRelease('v1.2.0', true)]);
    const res = await service.getSince('v1.0.0');
    expect(res.releases[0].changelogBody).toBe('### Features\n- f');
    expect(res.releases[0].highlights).toHaveLength(1);
  });
});
