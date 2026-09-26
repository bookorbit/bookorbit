import { isAllowedRedirectUri } from './redirect-uri';

const POLICY = {
  appUrl: 'http://localhost:6263',
  nativeRedirectUri: 'bookorbit://oauth2-callback',
};

describe('isAllowedRedirectUri', () => {
  describe('web redirect URI', () => {
    it('accepts the exact web callback', () => {
      expect(isAllowedRedirectUri('http://localhost:6263/oauth2-callback', POLICY)).toBe(true);
    });

    it('accepts a web callback carrying a query string', () => {
      expect(isAllowedRedirectUri('http://localhost:6263/oauth2-callback?redirect=/library', POLICY)).toBe(true);
    });

    it('tolerates a trailing slash on the configured app URL', () => {
      expect(isAllowedRedirectUri('http://localhost:6263/oauth2-callback', { ...POLICY, appUrl: 'http://localhost:6263/' })).toBe(true);
    });

    it('rejects a different origin', () => {
      expect(isAllowedRedirectUri('https://evil.example/oauth2-callback', POLICY)).toBe(false);
    });

    it('rejects a different path on the right origin', () => {
      expect(isAllowedRedirectUri('http://localhost:6263/somewhere-else', POLICY)).toBe(false);
    });
  });

  describe('native redirect URI', () => {
    it('accepts the configured private-use scheme', () => {
      expect(isAllowedRedirectUri('bookorbit://oauth2-callback', POLICY)).toBe(true);
    });

    /**
     * The regression this whole module exists for. `new URL()` reports origin "null" and an empty
     * pathname for every non-special scheme, so an origin+pathname comparison would treat every
     * private-use URI as equal to every other one and accept anything an attacker supplied.
     */
    it('rejects a different private-use scheme that normalizes identically', () => {
      expect(isAllowedRedirectUri('evil://oauth2-callback', POLICY)).toBe(false);
      expect(isAllowedRedirectUri('evil://anything', POLICY)).toBe(false);
      expect(isAllowedRedirectUri('bookorbit://somewhere-else', POLICY)).toBe(false);
    });

    it('rejects a native URI carrying extra query parameters', () => {
      expect(isAllowedRedirectUri('bookorbit://oauth2-callback?next=evil', POLICY)).toBe(false);
    });

    it('honours a reconfigured native scheme', () => {
      const policy = { ...POLICY, nativeRedirectUri: 'myfork://cb' };
      expect(isAllowedRedirectUri('myfork://cb', policy)).toBe(true);
      expect(isAllowedRedirectUri('bookorbit://oauth2-callback', policy)).toBe(false);
    });
  });

  it('rejects unparseable junk', () => {
    expect(isAllowedRedirectUri('', POLICY)).toBe(false);
    expect(isAllowedRedirectUri('not a uri', POLICY)).toBe(false);
  });
});
