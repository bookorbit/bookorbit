import { normalizeAudibleDomain } from './normalize-audible-domain';

describe('normalizeAudibleDomain', () => {
  it('returns com when config value is missing', () => {
    expect(normalizeAudibleDomain(undefined)).toBe('com');
    expect(normalizeAudibleDomain('')).toBe('com');
  });

  it('supports short and full audible host styles', () => {
    expect(normalizeAudibleDomain('com')).toBe('com');
    expect(normalizeAudibleDomain('audible.com')).toBe('com');
    expect(normalizeAudibleDomain('audible.co.uk')).toBe('co.uk');
  });

  it('normalizes full api hosts and urls', () => {
    expect(normalizeAudibleDomain('api.audible.fr')).toBe('fr');
    expect(normalizeAudibleDomain('https://audible.ca')).toBe('ca');
    expect(normalizeAudibleDomain('https://api.audible.de/path')).toBe('de');
  });
});
