import { BadRequestException } from '@nestjs/common';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'dns/promises';
import { ensureSafeUrl, ensureSafeRemoteHost, PrivateAddressException, RemoteHostResolutionException } from './ssrf.utils';

const lookupMock = vi.mocked(lookup);

describe('ensureSafeRemoteHost', () => {
  beforeEach(() => vi.resetAllMocks());

  it('passes for a public IPv4 address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('example.com')).resolves.toBeUndefined();
  });

  it('throws PrivateAddressException for localhost', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const err = await ensureSafeRemoteHost('localhost').catch((e) => e);
    expect(err).toBeInstanceOf(PrivateAddressException);
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('throws PrivateAddressException for .local hostname', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('keycloak.local')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for .localhost hostname', async () => {
    await expect(ensureSafeRemoteHost('app.localhost')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('allows localhost when allowLocal is enabled', async () => {
    await expect(ensureSafeRemoteHost('localhost', { allowLocal: true })).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('throws PrivateAddressException for private IPv4 literal (10.x.x.x)', async () => {
    await expect(ensureSafeRemoteHost('10.0.0.1')).rejects.toBeInstanceOf(PrivateAddressException);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('throws PrivateAddressException for private IPv4 literal (172.16.x.x)', async () => {
    await expect(ensureSafeRemoteHost('172.16.0.1')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for private IPv4 literal (192.168.x.x)', async () => {
    await expect(ensureSafeRemoteHost('192.168.1.1')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for private IPv4 via DNS (10.x.x.x)', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('internal')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for private IPv4 via DNS (172.16.x.x)', async () => {
    lookupMock.mockResolvedValue([{ address: '172.16.0.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('internal')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for private IPv4 via DNS (192.168.x.x)', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('internal')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for 169.254.x.x (link-local)', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.0.1', family: 4 }] as never);
    await expect(ensureSafeRemoteHost('metadata')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws BadRequestException when DNS lookup fails', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    const error = await ensureSafeRemoteHost('unresolvable.invalid').catch((caught) => caught);
    expect(error).toBeInstanceOf(RemoteHostResolutionException);
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it('throws PrivateAddressException when any resolved address is private (even if some are public)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(ensureSafeRemoteHost('mixed')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for IPv6 loopback literal', async () => {
    await expect(ensureSafeRemoteHost('[::1]')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('throws PrivateAddressException for IPv6 loopback via DNS', async () => {
    lookupMock.mockResolvedValue([{ address: '::1', family: 6 }] as never);
    await expect(ensureSafeRemoteHost('ip6-localhost')).rejects.toBeInstanceOf(PrivateAddressException);
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

  it('PrivateAddressException message describes the private-address case', async () => {
    const err = await ensureSafeRemoteHost('192.168.1.1').catch((e) => e);
    expect(err).toBeInstanceOf(PrivateAddressException);
    expect(err.getResponse()).toMatchObject({ message: 'URL resolves to a private or local address' });
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

  it('throws PrivateAddressException when host resolves to private IP', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeUrl('https://internal.lan')).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('PrivateAddressException from ensureSafeUrl is also a BadRequestException', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeUrl('https://internal.lan')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows private targets when allowPrivate is enabled', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(ensureSafeUrl('https://internal.lan', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
});
