import type { ResolvedIndexerSeedPolicy } from '../indexers/indexer-adapter';
import { resolveEffectiveSeedGoals } from './indexer-seed-policy';

describe('resolveEffectiveSeedGoals', () => {
  const policy: ResolvedIndexerSeedPolicy = {
    id: 1,
    adapterType: 'torznab',
    seedsBack: true,
    applyTrackerSeedGoals: true,
    seedRatioGoal: null,
    seedTimeMinutes: null,
  };

  it('resolves ratio and time independently', () => {
    expect(resolveEffectiveSeedGoals({ ...policy, seedRatioGoal: 1.5 }, { seedRatioGoal: 2, seedTimeMinutes: 61 })).toEqual({
      seedRatioGoal: 1.5,
      seedTimeMinutes: 61,
      ratioOrigin: 'manual',
      timeOrigin: 'tracker',
    });
  });

  it('uses manual time ahead of tracker time', () => {
    expect(resolveEffectiveSeedGoals({ ...policy, seedTimeMinutes: 120 }, { seedTimeMinutes: 60 })).toEqual({
      seedTimeMinutes: 120,
      ratioOrigin: 'client_default',
      timeOrigin: 'manual',
    });
  });

  it('keeps manual values and drops tracker fallback when disabled', () => {
    expect(
      resolveEffectiveSeedGoals({ ...policy, applyTrackerSeedGoals: false, seedRatioGoal: 1.25 }, { seedRatioGoal: 2, seedTimeMinutes: 60 }),
    ).toEqual({ seedRatioGoal: 1.25, ratioOrigin: 'manual', timeOrigin: 'client_default' });
  });

  it('omits invalid tracker dimensions independently', () => {
    expect(resolveEffectiveSeedGoals(policy, { seedRatioGoal: 0, seedTimeMinutes: 1.2 })).toEqual({
      seedTimeMinutes: 2,
      ratioOrigin: 'client_default',
      timeOrigin: 'tracker',
    });
  });
});
