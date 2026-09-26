import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePodcastUrl, PodcastUrlSecurityService } from './podcast-url-security.service';

describe('PodcastUrlSecurityService', () => {
  const service = new PodcastUrlSecurityService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    'http://127.0.0.1/feed',
    'http://10.0.0.1/feed',
    'http://[::1]/feed',
    'http://[::ffff:7f00:1]/feed',
    'http://[::7f00:1]/feed',
    'http://[64:ff9b::7f00:1]/feed',
    'http://169.254.169.254/latest',
  ])('rejects private destination %s', async (value) => {
    await expect(service.assertPublicDestination(new URL(value))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates every redirect before following it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/private-feed' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.fetch('https://8.8.8.8/feed')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects credentials and non-http protocols', () => {
    expect(() => parsePodcastUrl('https://user:secret@example.com/feed')).toThrow(BadRequestException);
    expect(() => parsePodcastUrl('file:///path/to/feed.xml')).toThrow(BadRequestException);
  });
});
