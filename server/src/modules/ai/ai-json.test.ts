import { extractJson, repairMessage, validateJson } from './ai-json';

describe('extractJson', () => {
  it.each([
    ['a bare object', '{"a":1}', { a: 1 }],
    ['a bare array', '[1,2]', [1, 2]],
    ['a fenced object', '```json\n{"a":1}\n```', { a: 1 }],
    ['a fence without a language', '```\n{"a":1}\n```', { a: 1 }],
    ['chatter around the object', 'Here is the JSON you asked for:\n{"a":{"b":"}"}}\nLet me know!', { a: { b: '}' } }],
    ['an escaped quote in a string', 'Result: {"a":"say \\"hi\\" {"}', { a: 'say "hi" {' }],
    ['a broken object before a good one', 'First {"a": oops} then {"a":2}', { a: 2 }],
  ])('reads %s', (_label, text, expected) => {
    expect(extractJson(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['empty', '   ', 'The reply was empty'],
    ['no object', 'I am unable to help with that.', 'The reply did not contain a JSON object'],
    ['an object cut short', '{"names":[{"name":"Eliz', 'The reply did not contain a JSON object'],
  ])('fails on %s', (_label, text, error) => {
    expect(extractJson(text)).toEqual({ ok: false, error });
  });
});

describe('validateJson', () => {
  const schema = {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 10 },
            kind: { enum: ['person', 'place'] },
            rank: { type: ['integer', 'null'], minimum: 1 },
          },
          required: ['name', 'kind'],
          additionalProperties: false,
        },
      },
      note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['names'],
  };

  it('accepts a value that fits', () => {
    expect(validateJson({ names: [{ name: 'Elizabeth', kind: 'person', rank: null }], note: null, extra: true }, schema)).toBeNull();
  });

  it.each([
    [{}, '$.names is missing'],
    [{ names: 'x' }, '$.names must be array, not a string'],
    [{ names: [] }, '$.names has fewer than 1 items'],
    [
      {
        names: [
          { name: 'a', kind: 'person' },
          { name: 'b', kind: 'person' },
          { name: 'c', kind: 'person' },
        ],
      },
      '$.names has more than 2 items',
    ],
    [{ names: [{ name: 'Elizabeth Bennet', kind: 'person' }] }, '$.names[0].name is longer than 10 characters'],
    [{ names: [{ name: 'a', kind: 'ship' }] }, '$.names[0].kind must be one of "person", "place"'],
    [{ names: [{ name: 'a', kind: 'person', rank: 1.5 }] }, '$.names[0].rank must be integer or null, not a number'],
    [{ names: [{ name: 'a', kind: 'person', rank: 0 }] }, '$.names[0].rank is below 1'],
    [{ names: [{ name: 'a', kind: 'person', age: 3 }] }, '$.names[0].age is not allowed'],
    [{ names: [{ name: 'a', kind: 'person' }], note: 4 }, '$.note matches none of the allowed shapes'],
  ])('reports %j', (value, error) => {
    expect(validateJson(value, schema)).toBe(error);
  });

  it('reports at most five problems', () => {
    const many = { names: [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }] };
    expect(validateJson(many, schema)?.split('; ')).toHaveLength(5);
  });
});

it('asks for a corrected object in the repair message', () => {
  expect(repairMessage('$.names is missing')).toBe(
    'Your reply was not valid: $.names is missing. Reply again with only the corrected JSON object, matching the schema exactly.',
  );
});
