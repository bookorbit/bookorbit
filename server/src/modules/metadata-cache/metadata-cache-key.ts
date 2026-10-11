import { createHash } from 'node:crypto';
import type { MetadataCacheNamespace } from '@bookorbit/types';

import { canonicalJson } from '../../common/provider-cache/canonicalize';
import type { CacheOperation } from '../../common/provider-cache/provider-cache-spec';
import { CACHE_SCHEMA_VERSION } from './metadata-cache.constants';

export interface CacheKeyParts {
  namespace: MetadataCacheNamespace;
  provider: string;
  providerVersion: number;
  operation: CacheOperation;
  fingerprintHash: string;
  inputs: Record<string, unknown>;
}

/** Short stable hash of a provider's result-affecting configuration; the raw values are never stored. */
export function hashFingerprint(fingerprint: string): string {
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
}

export function buildCacheKey(parts: CacheKeyParts): string {
  const material = canonicalJson({
    ns: parts.namespace,
    sv: CACHE_SCHEMA_VERSION[parts.namespace],
    p: parts.provider,
    pv: parts.providerVersion,
    op: parts.operation,
    cfg: parts.fingerprintHash,
    in: parts.inputs,
  });
  return createHash('sha256').update(material).digest('hex');
}

/** A fixed per-key fraction in [0, 1), so expiries of entries written together spread out. */
export function keyJitterFraction(keyHash: string): number {
  return Number.parseInt(keyHash.slice(0, 8), 16) / 0x100000000;
}
