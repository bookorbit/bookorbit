const REAL_PERCENTAGE_TOLERANCE = 0.00001;

// PostgreSQL real can store 99.95 as 99.949996; whole-number thresholds retain exact comparisons.
export function minimumProgressAtThreshold(threshold: number): number {
  return Number.isInteger(threshold) ? threshold : threshold - REAL_PERCENTAGE_TOLERANCE;
}

export function hasReachedProgressThreshold(progress: number, threshold: number): boolean {
  return progress >= minimumProgressAtThreshold(threshold);
}

export function isMeaningfulReadingSession(durationSeconds: number, progressDelta: number | null | undefined): boolean {
  return durationSeconds >= 300 || (progressDelta ?? 0) >= 1;
}
