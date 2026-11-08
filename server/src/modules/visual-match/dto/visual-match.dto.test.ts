import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { VisualMatchDto } from './visual-match.dto';

describe('VisualMatchDto', () => {
  it('accepts recognised lines with or without an ISBN', async () => {
    expect(await validate(plainToInstance(VisualMatchDto, { lines: ['DUNE', 'FRANK HERBERT'] }))).toHaveLength(0);
    expect(await validate(plainToInstance(VisualMatchDto, { lines: [], isbn: '9780441013593' }))).toHaveLength(0);
    expect(await validate(plainToInstance(VisualMatchDto, { lines: ['DUNE'], isbn: null }))).toHaveLength(0);
  });

  it('rejects too many lines, a long line, a line that is not text, and a long ISBN', async () => {
    const tooMany = plainToInstance(VisualMatchDto, { lines: Array.from({ length: 25 }, () => 'x') });
    const tooLong = plainToInstance(VisualMatchDto, { lines: ['x'.repeat(201)] });
    const notText = plainToInstance(VisualMatchDto, { lines: [42] });
    const longIsbn = plainToInstance(VisualMatchDto, { lines: [], isbn: '9'.repeat(21) });
    const missing = plainToInstance(VisualMatchDto, {});

    for (const dto of [tooMany, tooLong, notText, longIsbn, missing]) {
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
});
