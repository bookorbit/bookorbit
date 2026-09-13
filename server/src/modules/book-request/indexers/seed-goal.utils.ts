import { MAX_INDEXER_SEED_TIME_MINUTES } from '@bookorbit/types';

export function normalizeProviderSeedRatio(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function normalizeProviderSeedTimeMinutes(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const minutes = Math.ceil(value);
  return minutes <= MAX_INDEXER_SEED_TIME_MINUTES ? minutes : undefined;
}

export function normalizeTorznabSeedTimeSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return normalizeProviderSeedTimeMinutes(value / 60);
}
