import { sanitizeLogValue } from './log-sanitize.utils';

describe('sanitizeLogValue', () => {
  it('returns the value unchanged when it has no control characters', () => {
    expect(sanitizeLogValue('hello world')).toBe('hello world');
  });

  it('replaces carriage return with a space', () => {
    expect(sanitizeLogValue('line1\rline2')).toBe('line1 line2');
  });

  it('replaces newline with a space', () => {
    expect(sanitizeLogValue('line1\nline2')).toBe('line1 line2');
  });

  it('replaces tab with a space', () => {
    expect(sanitizeLogValue('col1\tcol2')).toBe('col1 col2');
  });

  it('replaces CRLF log-injection payload characters with spaces', () => {
    const payload = 'value\r\nINFO [injected] fake=log';
    expect(sanitizeLogValue(payload)).toBe('value  INFO [injected] fake=log');
  });

  it('truncates to default max length of 200', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeLogValue(long);
    expect(result).toHaveLength(200);
  });

  it('truncates to custom max length', () => {
    const result = sanitizeLogValue('abcdefgh', 4);
    expect(result).toBe('abcd');
  });

  it('does not truncate a value at exactly max length', () => {
    const exact = 'a'.repeat(200);
    expect(sanitizeLogValue(exact)).toBe(exact);
  });

  it('preserves empty string', () => {
    expect(sanitizeLogValue('')).toBe('');
  });

  it('handles a value shorter than default max length with no changes', () => {
    const short = 'short';
    expect(sanitizeLogValue(short)).toBe(short);
  });
});
