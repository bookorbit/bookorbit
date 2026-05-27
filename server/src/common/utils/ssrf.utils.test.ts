import { BadRequestException } from '@nestjs/common';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'dns/promises';
import { ensureSafeUrl, ensureSafeRemoteHost } from './ssrf.utils';

const lookupMock = vi.mocked(lookup);

describe('ensureSafeRemoteHost', () => {
  beforeEach(() => vi.resetAllMocks());

  it('passes for a public IPv4 address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('example.com')).resolves.toBeUndefined();
  });

  it('throws BadRequestException for localhost', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('localhost')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows localhost when allowLocal is enabled', async () => {
    await expect(ensureSafeRemoteHost('localhost', { allowLocal: true })).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for private IPv4 (10.x.x.x)', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('internal')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for private IPv4 (172.16.x.x)', async () => {
    lookupMock.mockResolvedValue([{ address: '172.16.0.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('internal')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for private IPv4 (192.168.x.x)', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('internal')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for 169.254.x.x (link-local)', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.0.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('metadata')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when DNS lookup fails', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(ensureSafeRemoteHost('unresolvable.invalid')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when any resolved address is private (even if some are public)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(ensureSafeRemoteHost('mixed')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for IPv6 loopback', async () => {
    lookupMock.mockResolvedValue([{ address: '::1', family: 6 }] as never);
    await expect(ensureSafeRemoteHost('ip6-localhost')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows private IPv4 literals when allowPrivate is enabled', async () => {
    await expect(ensureSafeRemoteHost('192.168.1.10', { allowPrivate: true })).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows private DNS resolutions when allowPrivate is enabled', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.7', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('internal', { allowPrivate: true })).resolves.toBeUndefined();
  });

  it('allows mixed public/private DNS resolutions when allowPrivate is enabled', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(ensureSafeRemoteHost('mixed', { allowPrivate: true })).resolves.toBeUndefined();
  });
});

describe('ensureSafeUrl', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns a parsed URL for a safe https URL', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const result = await ensureSafeUrl('https://example.com/path');
    expect(result).toBeInstanceOf(URL);
    expect(result.hostname).toBe('example.com');
  });

  it('throws BadRequestException for an invalid URL', async () => {
    await expect(ensureSafeUrl('not-a-url')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for non-http(s) protocol', async () => {
    await expect(ensureSafeUrl('ftp://example.com')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when host resolves to private IP', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeUrl('https://internal.lan')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows private targets when allowPrivate is enabled', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeUrl('https://internal.lan', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
});
