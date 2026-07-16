import { amazonOrigin, audibleApiOrigin, normalizeAmazonDomain, normalizeAudibleDomain } from './metadata-provider-hosts.utils';

describe('metadata provider hosts', () => {
  it('resolves supported Amazon marketplaces to fixed HTTPS origins', () => {
    expect(normalizeAmazonDomain(' AMAZON.CO.UK ')).toBe('amazon.co.uk');
    expect(amazonOrigin('amazon.co.uk')).toBe('https://www.amazon.co.uk');
  });

  it('rejects arbitrary Amazon hosts', () => {
    expect(normalizeAmazonDomain('localhost')).toBe('amazon.com');
    expect(amazonOrigin('amazon.com@127.0.0.1')).toBe('https://www.amazon.com');
  });

  it('normalizes supported Audible host styles and rejects arbitrary suffixes', () => {
    expect(normalizeAudibleDomain('https://api.audible.co.uk/path')).toBe('co.uk');
    expect(audibleApiOrigin('audible.co.uk')).toBe('https://api.audible.co.uk');
    expect(audibleApiOrigin('localhost')).toBe('https://api.audible.com');
  });

  it('bounds hostile Audible input and removes paths without a regular expression', () => {
    expect(normalizeAudibleDomain(`https://api.audible.co.uk/${'/'.repeat(100_000)}`)).toBe('co.uk');
    expect(normalizeAudibleDomain(`https://api.audible.com${'x'.repeat(10_000)}/path`)).toBe('com');
    expect(normalizeAudibleDomain({ length: Number.MAX_SAFE_INTEGER } as never)).toBe('com');
  });
});
