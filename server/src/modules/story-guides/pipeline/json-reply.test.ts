import { AiUnitSkipped } from '../../ai-jobs/ai-feature';
import { askForJson, firstJsonObject, parseJsonReply } from './json-reply';
import { fakeStepContext } from './step-context.testing';

describe('firstJsonObject', () => {
  it('reads the first object, past prose and fences around it', () => {
    expect(firstJsonObject('Here it is:\n```json\n{"a": [1, {"b": "}"}]}\n```\nand {"c": 2}')).toEqual({ a: [1, { b: '}' }] });
  });

  it('keeps braces and escaped quotes inside strings', () => {
    expect(firstJsonObject('{"quote": "he said \\"{no}\\" twice"}')).toEqual({ quote: 'he said "{no}" twice' });
  });

  it('is null for no object, an unclosed one, or one that does not parse', () => {
    expect(firstJsonObject('no json here')).toBeNull();
    expect(firstJsonObject('{"a": 1')).toBeNull();
    expect(firstJsonObject('{a: 1}')).toBeNull();
  });
});

describe('parseJsonReply', () => {
  it('repairs trailing commas only when the reply does not parse as it is', () => {
    expect(parseJsonReply('{"groups": [{"ids": [9,], "from": 3,},]}')).toEqual({ groups: [{ ids: [9], from: 3 }] });
    expect(parseJsonReply('{"text": "a,]"}')).toEqual({ text: 'a,]' });
  });
});

describe('askForJson', () => {
  const request = { user: 'u', maxOutputTokens: 10, effort: 'medium' as const };
  const read = (answer: Record<string, unknown>) => (Array.isArray(answer.items) ? answer.items : null);

  it('asks once more after an answer it cannot read', async () => {
    const ctx = fakeStepContext({}, (_, index) => (index === 0 ? 'not json' : '{"items": [1]}'));
    await expect(askForJson(ctx, request, read)).resolves.toEqual([1]);
    expect(ctx.requests).toHaveLength(2);
  });

  it('leaves the unit out as invalid-json after two', async () => {
    const ctx = fakeStepContext({}, () => '{"other": true}');
    const error = await askForJson(ctx, request, read).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiUnitSkipped);
    expect(error).toMatchObject({ reason: 'invalid-json' });
    expect(ctx.requests).toHaveLength(2);
  });

  it('passes a client error on without asking again', async () => {
    const ctx = fakeStepContext({}, () => new Error('network'));
    await expect(askForJson(ctx, request, read)).rejects.toThrow('network');
    expect(ctx.requests).toHaveLength(1);
  });
});
