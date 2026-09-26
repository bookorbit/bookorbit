import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { OptionalIntQueryPipe } from './optional-int-query.pipe';

const meta = { type: 'query', data: 'page' } as ArgumentMetadata;

describe('OptionalIntQueryPipe', () => {
  it('falls back only when the parameter is absent', () => {
    const pipe = new OptionalIntQueryPipe(0);
    expect(pipe.transform(undefined, meta)).toBe(0);
    expect(pipe.transform(null, meta)).toBe(0);
  });

  it('parses integers, including negatives the caller validates separately', () => {
    const pipe = new OptionalIntQueryPipe(0);
    expect(pipe.transform('7', meta)).toBe(7);
    expect(pipe.transform(' 12 ', meta)).toBe(12);
    expect(pipe.transform('-1', meta)).toBe(-1);
    expect(pipe.transform(3, meta)).toBe(3);
  });

  it('rejects a present value that is not an integer, rather than reading as the default', () => {
    const pipe = new OptionalIntQueryPipe(0);
    for (const value of ['abc', '', '   ', '1.7', 'NaN', '1e', {}]) {
      expect(() => pipe.transform(value, meta)).toThrow(BadRequestException);
    }
  });

  it('names the parameter in the message', () => {
    expect(() => new OptionalIntQueryPipe(50).transform('abc', { type: 'query', data: 'size' } as ArgumentMetadata)).toThrow(
      'size must be an integer number',
    );
  });
});
