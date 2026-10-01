const REAL_PERCENTAGE_TOLERANCE = 0.00001;

export function hasReachedProgressThreshold(progress: number, threshold: number): boolean {
  if (progress >= threshold) return true;
  // PostgreSQL real can store 99.95 as 99.949996; whole-number thresholds retain exact comparisons.
  return !Number.isInteger(threshold) && progress + REAL_PERCENTAGE_TOLERANCE >= threshold;
}
