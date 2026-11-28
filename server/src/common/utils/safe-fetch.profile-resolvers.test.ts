/**
 * A source whose profile names its own resolvers may use a host only those resolvers know, so the
 * pre-flight URL check has to resolve through them rather than through the system resolver.
 */
const profileAnswers = new Map<string, string[]>();

// One module to the test runner, with or without the `node:` prefix: the profile's resolvers
// know the host, the system resolver does not.
vi.mock('dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns/promises')>();
  class Resolver {
    setServers(): void {}
    resolve4(hostname: string): Promise<string[]> {
      const answer = profileAnswers.get(hostname);
      if (!answer) return Promise.reject(Object.assign(new Error(`queryA ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
      return Promise.resolve(answer);
    }
    resolve6(hostname: string): Promise<string[]> {
      return Promise.reject(Object.assign(new Error(`queryAaaa ENODATA ${hostname}`), { code: 'ENODATA' }));
    }
  }
  return {
    ...actual,
    Resolver,
    lookup: vi.fn((hostname: string) => Promise.reject(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }))),
  };
});

import { lookup } from 'dns/promises';

import { ensureSafeUrlFor } from './safe-fetch';
import { PrivateAddressException, RemoteHostResolutionException } from './ssrf.utils';

const profile = { resolvers: ['192.0.2.53'] };

describe('ensureSafeUrlFor', () => {
  afterEach(() => {
    profileAnswers.clear();
    vi.mocked(lookup).mockClear();
  });

  it('resolves the host through the profile resolvers', async () => {
    profileAnswers.set('files.lan-only.test', ['203.0.113.7']);

    const url = await ensureSafeUrlFor('https://files.lan-only.test/book.epub', { profile });

    expect(url.href).toBe('https://files.lan-only.test/book.epub');
    expect(vi.mocked(lookup)).not.toHaveBeenCalled();
  });

  it('still refuses a private answer from the profile resolvers', async () => {
    profileAnswers.set('files.lan-only.test', ['10.0.0.5']);

    await expect(ensureSafeUrlFor('https://files.lan-only.test/book.epub', { profile })).rejects.toBeInstanceOf(PrivateAddressException);
  });

  it('allows that private answer where the caller opted in', async () => {
    profileAnswers.set('files.lan-only.test', ['10.0.0.5']);

    await expect(ensureSafeUrlFor('https://files.lan-only.test/book.epub', { profile, allowPrivate: true })).resolves.toBeDefined();
  });

  it('keeps the system resolver for a profile with only a proxy', async () => {
    profileAnswers.set('files.lan-only.test', ['203.0.113.7']);

    await expect(
      ensureSafeUrlFor('https://files.lan-only.test/book.epub', { profile: { proxyUrl: 'http://proxy.example.com:8080' } }),
    ).rejects.toBeInstanceOf(RemoteHostResolutionException);
    expect(vi.mocked(lookup)).toHaveBeenCalled();
  });
});
