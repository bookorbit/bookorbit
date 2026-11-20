import { AiFeatureRegistry, validateFeature } from './ai-feature.registry';
import { createFakeAiFeature, createFakeFeatureState } from './testing/fake-ai-feature';

describe('AiFeatureRegistry', () => {
  it('registers a feature once and finds it by id', () => {
    const registry = new AiFeatureRegistry();
    const feature = createFakeAiFeature(createFakeFeatureState());
    registry.register(feature);
    expect(registry.get(feature.id)).toBe(feature);
    expect(registry.list()).toEqual([feature]);
    expect(registry.get('missing')).toBeNull();
    expect(() => registry.register(feature)).toThrow(/already registered/);
  });

  it('accepts the fake feature', () => {
    expect(() => validateFeature(createFakeAiFeature(createFakeFeatureState()))).not.toThrow();
  });

  it.each([
    ['an invalid id', { id: 'Not Valid' }, /id "Not Valid"/],
    ['an empty pipeline', { pipeline: '' }, /pipeline/],
    ['formats out of order', { formats: [2, 1] }, /ascending/],
    ['no formats', { formats: [] }, /ascending/],
    ['no steps', { steps: [] }, /no steps/],
  ])('refuses %s', (_label, change, message) => {
    const feature = { ...createFakeAiFeature(createFakeFeatureState()), ...change };
    expect(() => validateFeature(feature)).toThrow(message);
  });

  it('refuses a step that depends on a later one, a repeated step and a version below 1', () => {
    const feature = createFakeAiFeature(createFakeFeatureState());
    const [text, names, summary] = feature.steps;
    expect(() => validateFeature({ ...feature, steps: [names!, text!, summary!] })).toThrow(/does not come before/);
    expect(() => validateFeature({ ...feature, steps: [text!, text!] })).toThrow(/repeats step text/);
    expect(() => validateFeature({ ...feature, steps: [{ ...text!, version: 0 }] })).toThrow(/positive version/);
    expect(() => validateFeature({ ...feature, steps: [{ ...text!, id: 'Bad id' }] })).toThrow(/step id/);
  });
});
