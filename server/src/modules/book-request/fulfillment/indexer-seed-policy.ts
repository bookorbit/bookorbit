import type { ResolvedIndexerSeedPolicy } from '../indexers/indexer-adapter';
import { normalizeProviderSeedRatio, normalizeProviderSeedTimeMinutes } from '../indexers/seed-goal.utils';

export type SeedGoalOrigin = 'manual' | 'tracker' | 'client_default';

export interface EffectiveSeedGoals {
  seedRatioGoal?: number;
  seedTimeMinutes?: number;
  ratioOrigin: SeedGoalOrigin;
  timeOrigin: SeedGoalOrigin;
}

export function resolveEffectiveSeedGoals(
  policy: ResolvedIndexerSeedPolicy,
  tracker: { seedRatioGoal?: unknown; seedTimeMinutes?: unknown },
): EffectiveSeedGoals {
  const manualRatio = normalizeProviderSeedRatio(policy.seedRatioGoal);
  const trackerRatio = policy.applyTrackerSeedGoals ? normalizeProviderSeedRatio(tracker.seedRatioGoal) : undefined;
  const ratio = manualRatio ?? trackerRatio;

  const manualTime = normalizeProviderSeedTimeMinutes(policy.seedTimeMinutes);
  const trackerTime = policy.applyTrackerSeedGoals ? normalizeProviderSeedTimeMinutes(tracker.seedTimeMinutes) : undefined;
  const time = manualTime ?? trackerTime;

  return {
    ...(ratio !== undefined ? { seedRatioGoal: ratio } : {}),
    ...(time !== undefined ? { seedTimeMinutes: time } : {}),
    ratioOrigin: manualRatio !== undefined ? 'manual' : trackerRatio !== undefined ? 'tracker' : 'client_default',
    timeOrigin: manualTime !== undefined ? 'manual' : trackerTime !== undefined ? 'tracker' : 'client_default',
  };
}
