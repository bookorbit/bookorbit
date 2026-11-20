import { hashOf, stableStringify, unitFingerprint, upstreamDigest } from './ai-fingerprint';

describe('ai-fingerprint', () => {
  it('serialises objects with sorted keys at every level', () => {
    expect(stableStringify({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf('a', 'b')).not.toBe(hashOf('ab'));
  });

  it('changes a unit fingerprint when any part changes', () => {
    const base = { feature: 'f', step: 's', version: 1, model: 'm', generation: 1, upstream: 'u', own: 'o' };
    const original = unitFingerprint(base);
    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(unitFingerprint({ ...base })).toBe(original);
    for (const change of [
      { feature: 'g' },
      { step: 't' },
      { version: 2 },
      { model: 'n' },
      { model: null },
      { generation: 2 },
      { upstream: 'v' },
      { own: 'p' },
    ]) {
      expect(unitFingerprint({ ...base, ...change })).not.toBe(original);
    }
  });

  it('digests upstream results whatever order units finished in', () => {
    const a = upstreamDigest([
      {
        id: 'names',
        data: {
          results: new Map([
            ['p0', 1],
            ['p1', 2],
          ]),
          skipped: new Map(),
        },
      },
    ]);
    const b = upstreamDigest([
      {
        id: 'names',
        data: {
          results: new Map([
            ['p1', 2],
            ['p0', 1],
          ]),
          skipped: new Map(),
        },
      },
    ]);
    expect(a).toBe(b);
    const changed = upstreamDigest([
      {
        id: 'names',
        data: {
          results: new Map([
            ['p0', 1],
            ['p1', 3],
          ]),
          skipped: new Map(),
        },
      },
    ]);
    expect(changed).not.toBe(a);
    const skipped = upstreamDigest([{ id: 'names', data: { results: new Map([['p0', 1]]), skipped: new Map([['p1', 'refused']]) } }]);
    expect(skipped).not.toBe(a);
  });
});
