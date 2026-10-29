import { createHash } from 'crypto';
import {
  ALL_METADATA_FIELDS,
  isExternalMetadataProviderKeySyntax,
  type ExternalMetadataProviderKey,
  type MetadataField,
  type MetadataHttpProviderInfo,
  type MetadataHttpProviderMediaType,
} from '@bookorbit/types';

/** Params every spec provider takes; the rest are BookOrbit extensions a provider opts into. */
const BASE_SEARCH_PARAMS = ['query', 'author', 'mediaType'] as const;
const EXTENSION_SEARCH_PARAMS = new Set(['isbn', 'language', 'limit']);
const MEDIA_TYPES = new Set<MetadataHttpProviderMediaType>(['book', 'audiobook', 'comic']);
const FIELDS = new Set<string>(ALL_METADATA_FIELDS);

export const HTTP_PROVIDER_ID_MAX_LENGTH = 512;
const KEY_MAX_LENGTH = 32;
/** Only an opaque `#rrggbb`: the UI mixes it with theme colours, which a name or alpha would break. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_CONCURRENCY = 4;
const MAX_MIN_INTERVAL_MS = 60_000;

export type ProviderInfoResult = { ok: true; info: MetadataHttpProviderInfo } | { ok: false; error: string };

/**
 * Reads `GET /provider/info`. Only `name` is required, as in the base spec; every extension has a
 * default that keeps a base-spec provider working. What comes back is bounded and typed, so nothing
 * the provider wrote reaches the database or a client unchecked.
 */
export function parseProviderInfo(raw: unknown): ProviderInfoResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'provider info is not a JSON object' };
  const body = raw as Record<string, unknown>;

  const name = boundedText(body.name, 100);
  if (!name) return { ok: false, error: 'provider info has no name' };

  const key = typeof body.key === 'string' ? body.key.trim() : slugKey(name);
  if (!isExternalMetadataProviderKeySyntax(key)) {
    return {
      ok: false,
      error: `provider key "${key.slice(0, 40)}" must be 2-32 lowercase letters, digits or hyphens, start with a letter, and not be a reserved name`,
    };
  }

  const declaredParams = Array.isArray(body.searchParams) ? body.searchParams.filter((p): p is string => typeof p === 'string') : [];
  const mediaTypes = Array.isArray(body.mediaTypes)
    ? [...new Set(body.mediaTypes.filter((m): m is MetadataHttpProviderMediaType => MEDIA_TYPES.has(m as MetadataHttpProviderMediaType)))]
    : [];
  const rateLimit = body.rateLimit && typeof body.rateLimit === 'object' ? (body.rateLimit as Record<string, unknown>) : {};

  return {
    ok: true,
    info: {
      key: key as ExternalMetadataProviderKey,
      name,
      version: boundedText(body.version, 50),
      specVersion: boundedText(body.specVersion, 20) ?? '1',
      avatarUrl: httpUrl(body.avatarUrl),
      authenticationRequired: body.authenticationRequired === true,
      mediaTypes: mediaTypes.length > 0 ? mediaTypes : ['book', 'audiobook'],
      lookup: body.lookup === true,
      supportedFields: Array.isArray(body.supportedFields)
        ? [...new Set(body.supportedFields.filter((f): f is MetadataField => typeof f === 'string' && FIELDS.has(f)))]
        : null,
      searchParams: [...BASE_SEARCH_PARAMS, ...new Set(declaredParams.filter((p) => EXTENSION_SEARCH_PARAMS.has(p)))],
      idMaxLength: clampInt(body.idMaxLength, 1, HTTP_PROVIDER_ID_MAX_LENGTH, HTTP_PROVIDER_ID_MAX_LENGTH),
      bookUrlTemplate: urlTemplate(body.bookUrlTemplate),
      rateLimit: {
        maxConcurrency: clampInt(rateLimit.maxConcurrency, 1, MAX_CONCURRENCY, 2),
        minIntervalMs: clampInt(rateLimit.minIntervalMs, 0, MAX_MIN_INTERVAL_MS, 0),
      },
      coverShape: body.coverShape === 'portrait' || body.coverShape === 'square' ? body.coverShape : null,
      color: typeof body.color === 'string' && HEX_COLOR.test(body.color.trim()) ? body.color.trim().toLowerCase() : null,
    },
  };
}

/** A record link from the provider's template, or undefined when it has none or the id is unusable. */
export function bookUrlFromTemplate(info: MetadataHttpProviderInfo, id: string): string | undefined {
  if (!info.bookUrlTemplate || !id) return undefined;
  return httpUrl(info.bookUrlTemplate.replace('{id}', encodeURIComponent(id))) ?? undefined;
}

/** The spec version BookOrbit records for a provider it found no `/provider/info` on. */
export const FALLBACK_SPEC_VERSION = '0';

/**
 * What a provider without `/provider/info` (spec v0, most Audiobookshelf providers) is called: its
 * address. Host, port and path all count, so two such providers behind one host stay distinct.
 * `pinnedKey` is the key the provider was registered under: it outlives a change of address, the
 * way a provider's own key would.
 */
export function fallbackProviderInfo(baseUrl: string, pinnedKey?: string): { name: string; key: string; specVersion: '0' } {
  const url = new URL(baseUrl);
  const name = `${url.host}${url.pathname.replace(/\/+$/, '')}`.slice(0, 100);
  const derived = slugKey(name);
  // An IP address would start the key with a digit, and a host may be called "kobo".
  const key = pinnedKey ?? (isExternalMetadataProviderKeySyntax(derived) ? derived : slugKey(`p-${name}`));
  return { name, key, specVersion: FALLBACK_SPEC_VERSION };
}

export interface LabelledProvider {
  key: string;
  name: string;
  baseUrl: string;
}

/**
 * The label each registered provider is shown under, made unique. Two providers both called
 * "FantLab", or one called "Goodreads" beside the built-in, would otherwise read the same in every
 * chip and badge. A clashing name gets its host, or its key when the hosts match too.
 */
export function distinctProviderLabels(providers: readonly LabelledProvider[], takenNames: readonly string[]): Map<string, string> {
  const normalize = (value: string) => value.trim().toLowerCase();
  const taken = new Set(takenNames.map(normalize));
  const byName = new Map<string, LabelledProvider[]>();
  for (const provider of providers) {
    const group = byName.get(normalize(provider.name)) ?? [];
    group.push(provider);
    byName.set(normalize(provider.name), group);
  }
  const labels = new Map<string, string>();
  for (const provider of providers) {
    const group = byName.get(normalize(provider.name)) ?? [];
    if (group.length === 1 && !taken.has(normalize(provider.name))) {
      labels.set(provider.key, provider.name);
      continue;
    }
    const host = hostOf(provider.baseUrl);
    const hostShared = group.some((other) => other.key !== provider.key && hostOf(other.baseUrl) === host);
    labels.set(provider.key, `${provider.name} (${hostShared || !host ? provider.key : host})`);
  }
  return labels;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

/**
 * A key from free text. A slug too long for a key keeps its start and gains a hash of the whole
 * text, so two long names or addresses that share a prefix still get different keys.
 */
function slugKey(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= KEY_MAX_LENGTH) return slug;
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 8);
  return `${slug.slice(0, KEY_MAX_LENGTH - hash.length - 1).replace(/-+$/, '')}-${hash}`;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function httpUrl(value: unknown, max = 2048): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > max) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function urlTemplate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes('{id}')) return null;
  return httpUrl(value.replace('{id}', 'id')) ? value.trim() : null;
}
