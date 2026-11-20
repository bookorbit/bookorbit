import { AiUnitSkipped } from './ai-feature';
import { AiError } from './ai-jobs.ports';
import { halve, splitWhileTooLong } from './ai-split';

/** Answers with the part, unless it is longer than `limit`. */
function upTo(limit: number) {
  const parts: string[] = [];
  const attempt = (part: string) => {
    parts.push(part);
    return part.length > limit ? Promise.reject(new AiError('too-long')) : Promise.resolve(part);
  };
  return { parts, attempt };
}

describe('splitWhileTooLong', () => {
  it('runs a text that fits once', async () => {
    const { parts, attempt } = upTo(100);
    expect(await splitWhileTooLong('short text', attempt)).toEqual(['short text']);
    expect(parts).toEqual(['short text']);
  });

  it('halves a text that is too long until every part fits, keeping text order', async () => {
    const words = Array.from({ length: 600 }, (_, index) => `w${index}`);
    const text = words.join(' ');
    const { attempt } = upTo(1_000);
    const results = await splitWhileTooLong(text, attempt);
    expect(results.length).toBeGreaterThan(1);
    expect(results.every((part) => part.length <= 1_000)).toBe(true);
    expect(results.join(' ').split(' ')).toEqual(words);
  });

  it('leaves the unit out as too-long once a part at the floor is still too long', async () => {
    const { parts, attempt } = upTo(10);
    const text = 'word '.repeat(500).trim();
    await expect(splitWhileTooLong(text, attempt)).rejects.toEqual(new AiUnitSkipped('too-long'));
    expect(parts.at(-1)!.length).toBeLessThanOrEqual(1_000);
    expect(parts.every((part) => part.length > 500)).toBe(true);
  });

  it('honours another floor', async () => {
    const { attempt } = upTo(5);
    expect(await splitWhileTooLong('aaaa bbbb cccc dddd', attempt, 4)).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd']);
  });

  it('passes on any other error unchanged', async () => {
    const outage = new AiError('provider-down');
    await expect(splitWhileTooLong('text', () => Promise.reject(outage))).rejects.toBe(outage);
  });
});

describe('halve', () => {
  it('splits at the whitespace nearest the middle, trimming it', () => {
    expect(halve('one two three four')).toEqual(['one two', 'three four']);
    expect(halve('aaaaaaaa bb')).toEqual(['aaaaaaaa', 'bb']);
  });

  it('splits at the middle when there is no whitespace', () => {
    expect(halve('abcdef')).toEqual(['abc', 'def']);
  });
});
