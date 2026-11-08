import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { type ValidationError, validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ShelfMatchDto } from './shelf-match.dto';

/** The global pipe's options, so a field the DTO does not declare is refused as it is in the app. */
const check = (body: unknown): Promise<ValidationError[]> =>
  validate(plainToInstance(ShelfMatchDto, body), { whitelist: true, forbidNonWhitelisted: true });

const spine = (id: string, lines: string[] = ['DUNE', 'HERBERT']) => ({ id, lines });

describe('ShelfMatchDto', () => {
  it('accepts spines, a spine with no lines, and no spines at all', async () => {
    expect(await check({ spines: [spine('s1'), spine('s2', ['The Name of the Wind', 'Rothfuss', 'DAW'])] })).toHaveLength(0);
    expect(await check({ spines: [spine('s1', [])] })).toHaveLength(0);
    expect(await check({ spines: [] })).toHaveLength(0);
  });

  it('accepts every limit at its edge', async () => {
    const full = {
      spines: Array.from({ length: 40 }, (_, index) =>
        spine(
          `s${index}`.padEnd(16, 'x'),
          Array.from({ length: 6 }, () => 'x'.repeat(200)),
        ),
      ),
    };
    expect(await check(full)).toHaveLength(0);
  });

  it('rejects too many spines, too many lines, a long line, and a line that is not text', async () => {
    const tooManySpines = { spines: Array.from({ length: 41 }, (_, index) => spine(`s${index}`)) };
    const tooManyLines = {
      spines: [
        spine(
          's1',
          Array.from({ length: 7 }, () => 'x'),
        ),
      ],
    };
    const longLine = { spines: [spine('s1', ['x'.repeat(201)])] };
    const notText = { spines: [{ id: 's1', lines: [42] }] };

    for (const body of [tooManySpines, tooManyLines, longLine, notText]) {
      expect((await check(body)).length, JSON.stringify(body).slice(0, 60)).toBeGreaterThan(0);
    }
  });

  it('rejects a missing, empty, long or non-text spine id', async () => {
    const bodies = [
      { spines: [{ lines: ['DUNE'] }] },
      { spines: [spine('')] },
      { spines: [spine('x'.repeat(17))] },
      { spines: [{ id: 7, lines: ['DUNE'] }] },
    ];
    for (const body of bodies) {
      expect((await check(body)).length, JSON.stringify(body)).toBeGreaterThan(0);
    }
  });

  it('rejects a spine without lines, and spines that are not objects or an array', async () => {
    for (const body of [{ spines: [{ id: 's1' }] }, { spines: ['DUNE'] }, { spines: [null] }, { spines: 's1' }, {}]) {
      expect((await check(body)).length, JSON.stringify(body)).toBeGreaterThan(0);
    }
  });

  it('rejects a field it does not know, inside a spine as well as beside the spines', async () => {
    const nested = await check({ spines: [{ ...spine('s1'), isbn: '9780441013593' }] });
    expect(nested).toHaveLength(1);
    expect(nested[0].property).toBe('spines');
    expect(JSON.stringify(nested)).toContain('whitelistValidation');

    expect((await check({ spines: [spine('s1')], photo: 'abc' })).length).toBeGreaterThan(0);
  });
});
