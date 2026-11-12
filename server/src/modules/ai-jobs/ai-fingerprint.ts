import { createHash } from 'crypto';

/** JSON with object keys sorted at every level, so equal values always hash alike. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort()) sorted[key] = (item as Record<string, unknown>)[key];
    return sorted;
  });
}

/** SHA-256, in hex, of the parts in order. */
export function hashOf(...parts: unknown[]): string {
  return createHash('sha256').update(stableStringify(parts)).digest('hex');
}

export interface UnitFingerprintParts {
  feature: string;
  step: string;
  version: number;
  model: string | null;
  generation: number;
  /** `upstreamDigest` of the steps this one depends on. */
  upstream: string;
  /** The step's own fingerprint of the unit: its prompt and input. */
  own: string;
}

export function unitFingerprint(parts: UnitFingerprintParts): string {
  return hashOf('unit', parts.feature, parts.step, parts.version, parts.model, parts.generation, parts.upstream, parts.own);
}

export interface StepResults {
  results: ReadonlyMap<string, unknown>;
  skipped: ReadonlyMap<string, string>;
}

/**
 * Everything a dependent step can read from the steps it depends on: each unit's result, and which
 * units were left out. A dependent reruns when any of it changes, and only then.
 */
export function upstreamDigest(steps: readonly { id: string; data: StepResults }[]): string {
  return hashOf(
    'upstream',
    steps.map(({ id, data }) => [
      id,
      [...data.results.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      [...data.skipped.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]),
  );
}
