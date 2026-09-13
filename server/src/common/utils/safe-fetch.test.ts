import { hasNetworkProfile } from '@bookorbit/types';

/** The two resolutions the pinned path exists to collapse into one are both this function. */
vi.mock('dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns/promises')>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

import { lookup } from 'dns/promises';

import { forgetDispatchers, safeFetch } from './safe-fetch';
import { isPrivateOrLocalAddress } from './ssrf.utils';

describe('hasNetworkProfile', () => {
  /** The overwhelmingly common case, and it must cost nothing: no agent, no pooling, no undici. */
  it('treats an absent or empty profile as nothing configured', () => {
    expect(hasNetworkProfile(null)).toBe(false);
    expect(hasNetworkProfile(undefined)).toBe(false);
    expect(hasNetworkProfile({})).toBe(false);
    expect(hasNetworkProfile({ resolvers: [] })).toBe(false);
  });

  it('recognises either half on its own', () => {
    expect(hasNetworkProfile({ resolvers: ['1.1.1.1'] })).toBe(true);
    expect(hasNetworkProfile({ proxyUrl: 'http://proxy.example.com:8080' })).toBe(true);
  });
});

describe('safeFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  /**
   * Every existing caller passes no profile, so that path has to stay exactly what it was: the
   * global fetch, no dispatcher, no behaviour change.
   */
  it('uses the ordinary fetch when nothing is configured', async () => {
    await safeFetch('https://example.com/feed', { method: 'GET' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0] as string | URL).href).toBe('https://example.com/feed');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('still refuses a private address before any connection is attempted', async () => {
    await expect(safeFetch('http://127.0.0.1:8080/internal')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a private address where the caller opted in', async () => {
    await expect(safeFetch('http://127.0.0.1:8080/proxy', {}, { allowPrivate: true })).resolves.toBeDefined();
  });

  it('refuses a protocol that is not http or https', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow();
    await expect(safeFetch('ftp://example.com/x')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * A profile takes the undici path instead, so the global fetch must not be the one used: that is
   * what carries the single resolve-check-connect lookup.
   */
  it('leaves the ordinary fetch alone once a profile is configured', async () => {
    // A resolver on loopback refuses immediately rather than timing out, so the branch is proven
    // without the test waiting on a real DNS deadline.
    await safeFetch('https://example.com/', {}, { profile: { resolvers: ['127.0.0.1'] } }).catch(() => undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** A configured resolver changes how a name is found, never what is allowed once it is found. */
  it('does not let a profile widen what an address may be', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data', {}, { profile: { resolvers: ['1.1.1.1'] } })).rejects.toThrow();
  });
});

/**
 * The window the pre-flight cannot close on its own: a name is resolved once to be approved and
 * again to be connected to, and nothing says the two answers have to match.
 */
describe('safeFetch with the address pinned', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(lookup).mockReset();
    forgetDispatchers();
  });

  /**
   * Public on the lookup that approves it, private on every lookup after that: undici may retry a
   * refused connect, and a name that flipped once has flipped.
   */
  function answersPublicThenPrivate() {
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
  }

  it('refuses a name that answers publicly and then privately', async () => {
    answersPublicThenPrivate();

    await expect(safeFetch('http://rebound.example.com/x', {}, { pinResolvedAddress: true })).rejects.toThrow();
    // No socket was opened to either answer: the connect lookup refused before one could be.
    expect(fetchMock).not.toHaveBeenCalled();
    // Both halves of the window are the same call, and the second one is where it closes.
    expect(vi.mocked(lookup).mock.calls.length).toBeGreaterThan(1);
  });

  /**
   * The same sequence without pinning reaches the second answer, so what the option buys is stated
   * rather than assumed. That is the documented trade for the callers whose URLs an operator chose.
   */
  it('reaches the second answer where the caller did not ask for pinning', async () => {
    answersPublicThenPrivate();

    await expect(safeFetch('http://rebound.example.com/x')).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * The check the connect lookup applies is the same one the pre-flight applies, so the two cannot
 * drift into disagreeing about an address.
 */
describe('isPrivateOrLocalAddress', () => {
  it('catches the ranges an SSRF actually aims at', () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1']) {
      expect(isPrivateOrLocalAddress(address)).toBe(true);
    }
  });

  it('leaves ordinary public addresses alone', () => {
    for (const address of ['1.1.1.1', '104.20.23.154', '185.178.208.181', '2606:4700::1111']) {
      expect(isPrivateOrLocalAddress(address)).toBe(false);
    }
  });

  /** An IPv4 address written as a mapped IPv6 one is the same address and the same risk. */
  it('sees through an IPv4-mapped IPv6 address', () => {
    expect(isPrivateOrLocalAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalAddress('::ffff:8.8.8.8')).toBe(false);
  });
});
