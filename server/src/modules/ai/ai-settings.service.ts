import { Injectable, Logger } from '@nestjs/common';
import {
  AI_FAILURE_CODES,
  AI_FEATURE_DEFINITIONS,
  AI_READER_CAP_DEFAULTS,
  AI_FEATURES,
  AI_JSON_MODES,
  AI_SLOT_EFFORTS,
  AI_SLOTS,
  type AiBudgetSettings,
  type AiFailureCode,
  type AiFeatureDefinition,
  type AiFeatureId,
  type AiFeatureLimits,
  type AiFeatureSettings,
  type AiJsonMode,
  type AiModelPrices,
  type AiPrivacyConfirmation,
  type AiSlot,
  type AiSlotEffort,
  type AiSlotHealth,
  type AiSlotSettings,
  type AiSlotsSettings,
} from '@bookorbit/types';

import { AI_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';

export type AiSlotHealthMap = Partial<Record<AiSlot, AiSlotHealth>>;
export type AiFeatureSettingsMap = Record<AiFeatureId, AiFeatureSettings>;
export type AiPrivacyMap = Partial<Record<AiFeatureId, AiPrivacyConfirmation>>;

export interface AiSettingsSnapshot {
  slots: AiSlotsSettings;
  slotHealth: AiSlotHealthMap;
  features: AiFeatureSettingsMap;
  budget: AiBudgetSettings;
  privacy: AiPrivacyMap;
}

const ALL_KEYS = Object.values(AI_SETTING_KEYS);

/**
 * The AI settings in `app_settings`, one key per concern so that saving one part never rewrites
 * another. Every read is tolerant: a value this build does not understand (written by a newer
 * server, or damaged) falls back to its default without dropping the rest. Fields this build does
 * not know are kept when it writes the key back.
 */
@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  async snapshot(): Promise<AiSettingsSnapshot> {
    const values = await this.appSettings.getValues(ALL_KEYS);
    return {
      slots: decodeSlots(this.parse(values.get(AI_SETTING_KEYS.SLOTS), AI_SETTING_KEYS.SLOTS)),
      slotHealth: decodeSlotHealth(this.parse(values.get(AI_SETTING_KEYS.SLOT_HEALTH), AI_SETTING_KEYS.SLOT_HEALTH)),
      features: decodeFeatures(this.parse(values.get(AI_SETTING_KEYS.FEATURES), AI_SETTING_KEYS.FEATURES)),
      budget: decodeBudget(this.parse(values.get(AI_SETTING_KEYS.BUDGET), AI_SETTING_KEYS.BUDGET)),
      privacy: decodePrivacy(this.parse(values.get(AI_SETTING_KEYS.PRIVACY), AI_SETTING_KEYS.PRIVACY)),
    };
  }

  async slots(): Promise<AiSlotsSettings> {
    return decodeSlots(await this.read(AI_SETTING_KEYS.SLOTS));
  }

  async slotHealth(): Promise<AiSlotHealthMap> {
    return decodeSlotHealth(await this.read(AI_SETTING_KEYS.SLOT_HEALTH));
  }

  async features(): Promise<AiFeatureSettingsMap> {
    return decodeFeatures(await this.read(AI_SETTING_KEYS.FEATURES));
  }

  async budget(): Promise<AiBudgetSettings> {
    return decodeBudget(await this.read(AI_SETTING_KEYS.BUDGET));
  }

  async privacy(): Promise<AiPrivacyMap> {
    return decodePrivacy(await this.read(AI_SETTING_KEYS.PRIVACY));
  }

  /** True for a feature this server knows and the admin turned on. */
  async isFeatureEnabled(feature: string): Promise<boolean> {
    if (!isAiFeature(feature)) return false;
    return (await this.features())[feature].enabled;
  }

  async saveSlots(slots: AiSlotsSettings): Promise<void> {
    await this.merge(AI_SETTING_KEYS.SLOTS, slots);
  }

  async saveFeature(feature: AiFeatureId, settings: AiFeatureSettings): Promise<void> {
    await this.merge(AI_SETTING_KEYS.FEATURES, { [feature]: settings });
  }

  async saveBudget(budget: AiBudgetSettings): Promise<void> {
    await this.merge(AI_SETTING_KEYS.BUDGET, budget);
  }

  async savePrivacy(feature: AiFeatureId, confirmation: AiPrivacyConfirmation): Promise<void> {
    await this.merge(AI_SETTING_KEYS.PRIVACY, { [feature]: confirmation });
  }

  /** Server-written only. Null clears the slot's entry. */
  async setSlotHealth(slot: AiSlot, health: AiSlotHealth | null): Promise<void> {
    const raw = asRecord(await this.read(AI_SETTING_KEYS.SLOT_HEALTH));
    if (health) raw[slot] = health;
    else delete raw[slot];
    await this.appSettings.setValue(AI_SETTING_KEYS.SLOT_HEALTH, JSON.stringify(raw));
  }

  private async read(key: string): Promise<unknown> {
    return this.parse(await this.appSettings.getValue(key), key);
  }

  /** Writes `patch` over what is stored, keeping keys this build does not know. */
  private async merge(key: string, patch: object): Promise<void> {
    const stored = asRecord(await this.read(key));
    await this.appSettings.setValue(key, JSON.stringify({ ...stored, ...patch }));
  }

  private parse(value: string | null | undefined, key: string): unknown {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      this.logger.warn(`[ai-settings] [read] key=${sanitizeLogValue(key)} - Stored value is not JSON; using defaults`);
      return undefined;
    }
  }
}

export function isAiFeature(value: string): value is AiFeatureId {
  return (AI_FEATURES as readonly string[]).includes(value);
}

export function emptySlot(): AiSlotSettings {
  return { connectionId: null, model: null, prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' };
}

export function defaultFeatureSettings(feature: AiFeatureId): AiFeatureSettings {
  const definition: AiFeatureDefinition = AI_FEATURE_DEFINITIONS[feature];
  return {
    enabled: false,
    limits: Object.fromEntries(Object.entries(definition.limits).map(([name, range]) => [name, range.default])) as AiFeatureLimits,
    monthlyBudget: null,
    buildsPerMonth: null,
    ...(definition.perReader ? { ...AI_READER_CAP_DEFAULTS } : {}),
  };
}

function decodeSlots(raw: unknown): AiSlotsSettings {
  const record = asRecord(raw);
  return Object.fromEntries(AI_SLOTS.map((slot) => [slot, decodeSlot(record[slot])])) as AiSlotsSettings;
}

function decodeSlot(raw: unknown): AiSlotSettings {
  const record = asRecord(raw);
  const connectionId = positiveInt(record.connectionId);
  const model = typeof record.model === 'string' && record.model.trim() ? record.model : null;
  return {
    connectionId,
    model,
    prices: decodePrices(record.prices),
    jsonMode: (AI_JSON_MODES as readonly unknown[]).includes(record.jsonMode) ? (record.jsonMode as AiJsonMode) : 'auto',
    maxOutputTokens: positiveInt(record.maxOutputTokens),
    // A level a newer server saved that this one does not know is left to the features.
    effort: (AI_SLOT_EFFORTS as readonly unknown[]).includes(record.effort) ? (record.effort as AiSlotEffort) : 'auto',
  };
}

function decodePrices(raw: unknown): AiModelPrices | null {
  const record = asRecord(raw);
  const input = nonNegative(record.input);
  const output = nonNegative(record.output);
  return input === null || output === null ? null : { input, output };
}

function decodeSlotHealth(raw: unknown): AiSlotHealthMap {
  const record = asRecord(raw);
  const health: AiSlotHealthMap = {};
  for (const slot of AI_SLOTS) {
    const entry = asRecord(record[slot]);
    if (typeof entry.failingSince !== 'string' || typeof entry.model !== 'string') continue;
    const code = (AI_FAILURE_CODES as readonly unknown[]).includes(entry.code) ? (entry.code as AiFailureCode) : 'provider-error';
    health[slot] = { failingSince: entry.failingSince, code, reason: typeof entry.reason === 'string' ? entry.reason : '', model: entry.model };
  }
  return health;
}

function decodeFeatures(raw: unknown): AiFeatureSettingsMap {
  const record = asRecord(raw);
  return Object.fromEntries(AI_FEATURES.map((feature) => [feature, decodeFeature(feature, record[feature])])) as AiFeatureSettingsMap;
}

function decodeFeature(feature: AiFeatureId, raw: unknown): AiFeatureSettings {
  const defaults = defaultFeatureSettings(feature);
  const record = asRecord(raw);
  const storedLimits = asRecord(record.limits);
  const limits: AiFeatureLimits = { ...defaults.limits };
  for (const [name, range] of Object.entries(AI_FEATURE_DEFINITIONS[feature].limits)) {
    const value = storedLimits[name];
    if (typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max) {
      limits[name as keyof AiFeatureLimits] = value;
    }
  }
  const settings: AiFeatureSettings = {
    enabled: record.enabled === true,
    limits,
    monthlyBudget: nonNegative(record.monthlyBudget),
    buildsPerMonth: positiveInt(record.buildsPerMonth),
  };
  if ((AI_FEATURE_DEFINITIONS[feature] as AiFeatureDefinition).perReader) {
    // Absent means never saved, so the default cap; null means the admin cleared it.
    settings.readerMonthlyBudget = 'readerMonthlyBudget' in record ? nonNegative(record.readerMonthlyBudget) : defaults.readerMonthlyBudget;
    settings.readerRequestsPerMonth =
      'readerRequestsPerMonth' in record ? positiveInt(record.readerRequestsPerMonth) : defaults.readerRequestsPerMonth;
  }
  return settings;
}

function decodeBudget(raw: unknown): AiBudgetSettings {
  const record = asRecord(raw);
  return {
    monthlyBudget: nonNegative(record.monthlyBudget),
    buildsPerMonth: positiveInt(record.buildsPerMonth),
  };
}

function decodePrivacy(raw: unknown): AiPrivacyMap {
  const record = asRecord(raw);
  const privacy: AiPrivacyMap = {};
  for (const feature of AI_FEATURES) {
    const entry = asRecord(record[feature]);
    if (typeof entry.at !== 'string' || typeof entry.userId !== 'number') continue;
    privacy[feature] = { userId: entry.userId, username: typeof entry.username === 'string' ? entry.username : '', at: entry.at };
  }
  return privacy;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
