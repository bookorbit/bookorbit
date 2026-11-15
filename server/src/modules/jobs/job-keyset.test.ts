import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { afterPosition, compareJobPositions, keysetOrder, type KeysetColumns } from './job-keyset';

const dialect = new PgDialect();

function render(fragment: ReturnType<typeof sql>) {
  return dialect.sqlToQuery(fragment);
}

const queue: KeysetColumns = {
  prefix: [
    { kind: 'number', expr: sql.raw('g') },
    { kind: 'number', expr: sql.raw('r') },
  ],
  suffix: [{ kind: 'time', expr: sql.raw('at') }],
  id: { kind: 'uuid', expr: sql.raw('id') },
};

const ended: KeysetColumns = { prefix: [{ kind: 'time', expr: sql.raw('fin') }], suffix: [], id: { kind: 'text', expr: sql.raw('code') } };

const position = { prefix: [1, 4], suffix: [1_763_164_800_000_001], typeIndex: 3, id: 'a1' };

describe('afterPosition', () => {
  it('needs a strictly later prefix from a type before the cursor', () => {
    const { sql: text, params } = render(afterPosition(queue, 'queue', position, 1));
    expect(text).toBe('(g > $1 or (g = $2 and r > $3))');
    expect(params).toEqual([1, 1, 4]);
  });

  it('accepts an equal prefix from a type after the cursor', () => {
    const { sql: text, params } = render(afterPosition(queue, 'queue', position, 5));
    expect(text).toBe('(g > $1 or (g = $2 and r > $3) or (g = $4 and r = $5))');
    expect(params).toEqual([1, 1, 4, 1, 4]);
  });

  it("compares the full key, timestamps against the raw column, inside the cursor's own type", () => {
    const { sql: text, params } = render(afterPosition(queue, 'queue', position, 3));
    expect(text).toContain("at > (timestamptz 'epoch' + $");
    expect(text).toContain("::bigint * interval '1 microsecond')");
    expect(text).toContain('id > $');
    expect(text).toContain('::uuid');
    expect(params).toEqual([1, 1, 4, 1, 4, 1_763_164_800_000_001, 1, 4, 1_763_164_800_000_001, 'a1']);
  });

  it('runs newest first in ended views and compares text ids byte by byte', () => {
    const { sql: text } = render(afterPosition(ended, 'history', { prefix: [9], suffix: [], typeIndex: 0, id: 'b' }, 0));
    expect(text).toContain("fin < (timestamptz 'epoch'");
    expect(text).toContain('code collate "C" < $');
  });
});

describe('keysetOrder', () => {
  it("orders by every component in the view's direction", () => {
    expect(keysetOrder(queue, 'queue').map((part) => render(part).sql)).toEqual(['g asc', 'r asc', 'at asc', 'id asc']);
    expect(keysetOrder(ended, 'failed').map((part) => render(part).sql)).toEqual(['fin desc', 'code collate "C" desc']);
  });
});

describe('compareJobPositions', () => {
  it('puts type order between prefix and suffix, ascending in every view', () => {
    const a = { prefix: [5], suffix: [], typeIndex: 2, id: 'a' };
    const b = { prefix: [5], suffix: [], typeIndex: 0, id: 'z' };
    expect(compareJobPositions('history', b, a)).toBeLessThan(0);
    expect(compareJobPositions('history', { ...a, prefix: [6] }, b)).toBeLessThan(0);
    expect(compareJobPositions('queue', { ...a, prefix: [4] }, b)).toBeLessThan(0);
  });

  it('compares numeric ids as numbers and text ids by code unit', () => {
    const base = { prefix: [1, 1], suffix: [0], typeIndex: 0 };
    expect(compareJobPositions('queue', { ...base, id: 9 }, { ...base, id: 10 })).toBeLessThan(0);
    expect(compareJobPositions('queue', { ...base, id: 'B' }, { ...base, id: 'a' })).toBeLessThan(0);
  });
});
