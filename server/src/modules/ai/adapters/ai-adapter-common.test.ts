import { parseModelList, refusesEffort } from './ai-adapter-common';

const listOf = (...models: unknown[]) => parseModelList(JSON.stringify({ data: models })).models;

describe('parseModelList effort levels', () => {
  it("reads Anthropic's capability flags, in order, and a model that takes no effort", () => {
    const [opus, haiku] = listOf(
      {
        id: 'claude-opus-5-5',
        capabilities: {
          effort: {
            supported: true,
            max: { supported: true },
            low: { supported: true },
            medium: { supported: true },
            high: { supported: true },
            xhigh: { supported: false },
          },
        },
      },
      { id: 'claude-haiku-5-5', capabilities: { effort: { supported: false } } },
    );
    expect(opus.efforts).toEqual(['low', 'medium', 'high', 'max']);
    expect(haiku.efforts).toEqual([]);
  });

  it("reads OpenRouter's levels and default, and leaves none out for a model that always reasons", () => {
    const [optional, mandatory] = listOf(
      { id: 'openai/gpt-6-luna', reasoning: { supported_efforts: ['high', 'none', 'low', 'turbo'], default_effort: 'low' } },
      { id: 'deepseek/r3', reasoning: { supported_efforts: ['none', 'medium'], mandatory: true, default_effort: 'none' } },
    );
    expect(optional).toMatchObject({ efforts: ['none', 'low', 'high'], defaultEffort: 'low' });
    expect(mandatory.efforts).toEqual(['medium']);
    expect(mandatory.defaultEffort).toBeUndefined();
  });

  it('knows a listed model without reasoning takes no effort, and says nothing where the list does not', () => {
    const [plain, thinking, bare] = listOf(
      { id: 'mistral/small', supported_parameters: ['temperature', 'max_tokens'] },
      { id: 'qwen/qwen4', supported_parameters: ['reasoning', 'temperature'] },
      { id: 'gpt-6-luna' },
    );
    expect(plain.efforts).toEqual([]);
    expect(thinking.efforts).toBeUndefined();
    expect(bare.efforts).toBeUndefined();
    expect(bare.defaultEffort).toBeUndefined();
  });
});

describe('refusesEffort', () => {
  it.each([
    "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
    'Invalid reasoning_effort: minimal. Valid values are low, medium, high.',
    'Model grok-5 does not support parameter reasoningEffort.',
    'Reasoning effort is not supported for this model',
    '"gemma4" does not support thinking',
    'invalid reasoning value: "max"',
    'unknown level "ultra", valid levels: low, medium, high',
  ])('%s', (message) => {
    expect(refusesEffort(message)).toBe(true);
  });

  it.each(['Invalid value for temperature', 'reasoning_effort was applied', 'messages: field required'])('not %s', (message) => {
    expect(refusesEffort(message)).toBe(false);
  });
});
