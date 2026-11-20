import type { NetworkProfile } from "./network-profile";

/**
 * The request formats a connection can speak. Stored as a plain string, so a connection saved by a
 * newer server with a type this build does not know is listed as unusable rather than failing the
 * whole list.
 */
export const AI_API_TYPES = ["openai-chat", "anthropic-messages", "openai-responses"] as const;
export type AiApiType = (typeof AI_API_TYPES)[number];

export function isAiApiType(value: unknown): value is AiApiType {
  return typeof value === "string" && (AI_API_TYPES as readonly string[]).includes(value);
}

/** Named roles a feature asks for. Features never name a provider. `vision` reads photos. */
export const AI_SLOTS = ["fast", "careful", "vision"] as const;
export type AiSlot = (typeof AI_SLOTS)[number];

/** How a slot asks for JSON. `auto` follows what the last connection test found. */
export const AI_JSON_MODES = ["auto", "schema", "json", "instructions"] as const;
export type AiJsonMode = (typeof AI_JSON_MODES)[number];
export type AiJsonSupport = Exclude<AiJsonMode, "auto">;

/**
 * Reasoning effort, lowest first, as most providers name the levels. Each model takes its own
 * subset, some take none, and a few providers remap a level silently; a model list says which
 * levels a model takes where the provider publishes it.
 */
export const AI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

/** A slot's effort. `auto` sends what each feature asks for, as before slots had an effort. */
export const AI_SLOT_EFFORTS = ["auto", ...AI_EFFORTS] as const;
export type AiSlotEffort = (typeof AI_SLOT_EFFORTS)[number];

export function isAiEffort(value: unknown): value is AiEffort {
  return typeof value === "string" && (AI_EFFORTS as readonly string[]).includes(value);
}

/** AI features the server knows. Settings, ledger rows and budgets are keyed by these ids. */
export const AI_FEATURES = ["story-guides", "vision-scan", "reading-help"] as const;
export type AiFeatureId = (typeof AI_FEATURES)[number];

export const AI_CONNECTION_LIMITS = {
  timeoutMs: { default: 120_000, min: 10_000, max: 600_000 },
  maxParallel: { default: 8, min: 1, max: 32 },
  requestsPerMinute: { min: 1, max: 10_000 },
} as const;

export const AI_NAME_MAX_LENGTH = 80;
export const AI_URL_MAX_LENGTH = 2048;
export const AI_MODEL_MAX_LENGTH = 200;
export const AI_KEY_MAX_LENGTH = 4096;
export const AI_HEADER_MAX_COUNT = 10;
export const AI_HEADER_NAME_MAX_LENGTH = 100;
export const AI_HEADER_VALUE_MAX_LENGTH = 2048;

/**
 * Header names a connection may not set, because the API type sets them itself. Compared in lower
 * case. `api-key` stays allowed: Azure takes its key that way.
 */
export const AI_RESERVED_HEADER_NAMES = [
  "authorization",
  "x-api-key",
  "anthropic-version",
  "content-type",
  "content-length",
  "accept",
  "accept-encoding",
  "host",
  "connection",
  "transfer-encoding",
  "cookie",
] as const;

/** A header on a connection as the page sees it: the name, and whether a value is stored. */
export interface AiConnectionHeader {
  name: string;
  hasValue: boolean;
  /** Last four characters of the stored value, for telling two apart. */
  valueHint: string | null;
}

export type AiConnectionStatus = "working" | "failing" | "untested";

/** One checklist row of a connection test, in order. */
/** `image` came later: tests stored before it have no such row, and it never decides `ok`. */
export const AI_TEST_STEPS = ["reach", "key", "models", "json", "usage", "image"] as const;
export type AiTestStepId = (typeof AI_TEST_STEPS)[number];

/**
 * Why a test row or a request failed, as a code the page turns into words. A code this build does
 * not know shows the provider's own message.
 */
export const AI_FAILURE_CODES = [
  "unreachable",
  "timeout",
  "tls",
  "redirect",
  "web-page",
  "blocked-address",
  "invalid-url",
  "key-rejected",
  "key-unreadable",
  "out-of-credit",
  "spend-limit",
  "rate-limited",
  "model-missing",
  "no-model",
  "no-model-list",
  "no-json",
  "no-usage",
  "unsupported-api-type",
  "provider-error",
  "no-image-input",
  "effort-rejected",
] as const;
export type AiFailureCode = (typeof AI_FAILURE_CODES)[number];

export interface AiTestStep {
  id: AiTestStepId;
  /** Null when the row did not run because an earlier one failed. */
  ok: boolean | null;
  code?: AiFailureCode;
  /** The provider's own message, with any key or header value removed. */
  message?: string;
  /** `reach`: milliseconds to the first answer. */
  durationMs?: number;
  /** `models`: how many the provider listed. */
  modelCount?: number;
  /** `json`: how the model answered in JSON. */
  jsonSupport?: AiJsonSupport;
  /** `redirect`: where the provider pointed. */
  location?: string;
  /** `rate-limited`: when to try again. */
  retryAfterSeconds?: number;
}

export interface AiConnectionTest {
  at: string;
  ok: boolean;
  host: string;
  model: string | null;
  steps: AiTestStep[];
  jsonSupport: AiJsonSupport | null;
  modelCount: number | null;
}

/** What a test route returns: the stored test plus the model list it fetched, for the model select. */
export interface AiConnectionTestResult extends AiConnectionTest {
  models: AiModelList | null;
}

/** Ledger feature ids for the admin's own requests, which are not features. */
export const AI_TEST_USAGE_FEATURE = "connection-test";
export const AI_TRY_USAGE_FEATURE = "try-it";

export interface AiConnection {
  id: number;
  name: string;
  /** Raw stored value; `usable` is false when this build does not know it. */
  apiType: string;
  usable: boolean;
  baseUrl: string;
  hasKey: boolean;
  /** Last four characters of the key, never more. */
  keyHint: string | null;
  headers: AiConnectionHeader[];
  networkProfile: NetworkProfile | null;
  timeoutMs: number;
  maxParallel: number;
  requestsPerMinute: number | null;
  status: AiConnectionStatus;
  lastTest: AiConnectionTest | null;
  failingSince: string | null;
  failingCode: AiFailureCode | null;
  /** Plain words, with any key or header value removed. */
  failingReason: string | null;
  /** This month, through this connection. */
  month: { requests: number; costMicros: number };
  createdAt: string;
  updatedAt: string;
}

export interface AiConnectionHeaderInput {
  name: string;
  /** Absent on an edit keeps the stored value for this name. */
  value?: string;
}

export interface CreateAiConnectionRequest {
  name: string;
  apiType: AiApiType;
  baseUrl: string;
  key?: string | null;
  headers?: AiConnectionHeaderInput[];
  networkProfile?: NetworkProfile | null;
  timeoutMs?: number;
  maxParallel?: number;
  requestsPerMinute?: number | null;
}

/** Absent fields stay as they are. `key: null` removes the key; `headers` replaces the list. */
export type UpdateAiConnectionRequest = Partial<CreateAiConnectionRequest>;

/** An unsaved connection, tested before it is saved. With `connectionId`, a missing key or header value is read from that saved connection. */
export interface TestAiConnectionRequest extends CreateAiConnectionRequest {
  connectionId?: number;
  model?: string;
}

export interface TestSavedAiConnectionRequest {
  model?: string;
}

export interface AiModelPrices {
  /** Dollars per million input tokens. */
  input: number;
  /** Dollars per million output tokens. */
  output: number;
}

export interface AiModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  prices?: AiModelPrices;
  /**
   * The effort levels the model takes, lowest first, when the provider publishes them; empty when
   * it takes none. Absent when the provider does not say.
   */
  efforts?: AiEffort[];
  /** The level the provider uses when none is sent, when it says. */
  defaultEffort?: AiEffort;
}

export interface AiModelList {
  /** False when the provider has no model list; the model is typed then. */
  listed: boolean;
  models: AiModelInfo[];
}

export interface AiSlotSettings {
  connectionId: number | null;
  model: string | null;
  prices: AiModelPrices | null;
  jsonMode: AiJsonMode;
  /** The model's output limit when its list gave one; caps the retry of a reply cut short. */
  maxOutputTokens: number | null;
  /** A level chosen here is sent on every request and never dropped quietly when refused. */
  effort: AiSlotEffort;
}

export type AiSlotsSettings = Record<AiSlot, AiSlotSettings>;

/** Written by the server only. Cleared for a slot when its model changes. */
export interface AiSlotHealth {
  failingSince: string;
  code: AiFailureCode;
  reason: string;
  model: string;
}

/** Limits a feature defines for itself. Story guides: longest book in words, builds at once. */
export interface AiFeatureLimits {
  maxWords?: number;
  concurrentBuilds?: number;
}

export interface AiFeatureSettings {
  enabled: boolean;
  limits: AiFeatureLimits;
  /** Dollars a month this feature may spend; null for the whole server budget. */
  monthlyBudget: number | null;
  /** Builds a month, used when its slots have no prices; null for no limit. */
  buildsPerMonth: number | null;
  /**
   * Dollars a month one reader may spend through this feature; null for no cap. Only features
   * marked `perReader` use it. Absent from settings saved before the field.
   */
  readerMonthlyBudget?: number | null;
  /** Requests a month one reader may make, used when its slots have no prices; null for no cap. */
  readerRequestsPerMonth?: number | null;
}

export interface AiPrivacyConfirmation {
  userId: number;
  username: string;
  at: string;
}

export interface AiBudgetSettings {
  /** Dollars a month for the whole server; null for no budget. */
  monthlyBudget: number | null;
  buildsPerMonth: number | null;
}

export interface AiFeatureDefinition {
  id: AiFeatureId;
  slots: AiSlot[];
  /** The limits this feature has; a feature with none leaves it empty. */
  limits: Partial<Record<keyof AiFeatureLimits, { default: number; min: number; max: number }>>;
  /**
   * `jobs` builds through the job queue, so builds per month apply; `requests` answers one request
   * at a time and is capped by money only.
   */
  runs: "jobs" | "requests";
  /** Slots the feature uses when they have a model, without needing them to run. */
  optionalSlots?: AiSlot[];
  /** Readers make the requests, so the per-reader caps apply. */
  perReader?: boolean;
}

/** Per-reader caps a `perReader` feature starts with. */
export const AI_READER_CAP_DEFAULTS = { readerMonthlyBudget: 1, readerRequestsPerMonth: 300 } as const;

export const AI_FEATURE_DEFINITIONS = {
  "story-guides": {
    id: "story-guides",
    slots: ["fast", "careful"],
    limits: {
      maxWords: { default: 400_000, min: 10_000, max: 2_000_000 },
      concurrentBuilds: { default: 1, min: 1, max: 3 },
    },
    runs: "jobs",
  },
  "vision-scan": {
    id: "vision-scan",
    slots: ["vision"],
    limits: {},
    runs: "requests",
  },
  "reading-help": {
    id: "reading-help",
    slots: ["fast"],
    optionalSlots: ["careful"],
    limits: {},
    runs: "requests",
    perReader: true,
  },
} satisfies Record<AiFeatureId, AiFeatureDefinition>;

export interface AiFeatureState {
  id: AiFeatureId;
  settings: AiFeatureSettings;
  privacy: AiPrivacyConfirmation | null;
  /** Slots the feature needs that are empty, which keep it from building. */
  missingSlots: AiSlot[];
}

export interface AiSettings {
  slots: AiSlotsSettings;
  slotHealth: Partial<Record<AiSlot, AiSlotHealth>>;
  features: AiFeatureState[];
  budget: AiBudgetSettings;
}

export interface UpdateAiSlotRequest {
  connectionId: number | null;
  model: string | null;
  prices?: AiModelPrices | null;
  jsonMode?: AiJsonMode;
  maxOutputTokens?: number | null;
  /** Left out: kept for the same model, `auto` for a new one. */
  effort?: AiSlotEffort;
}

/** What saving the slots returns: the settings, and which slots the save changed. */
export interface AiSlotsUpdateResult extends AiSettings {
  changed: AiSlot[];
}

/** Slots left out stay as they are. */
export type UpdateAiSlotsRequest = Partial<Record<AiSlot, UpdateAiSlotRequest>>;

/** Fields left out stay as they are. `confirmPrivacy` is required the first time a feature turns on. */
export interface UpdateAiFeatureRequest {
  enabled?: boolean;
  confirmPrivacy?: boolean;
  limits?: AiFeatureLimits;
  monthlyBudget?: number | null;
  buildsPerMonth?: number | null;
  /** Only for a feature marked `perReader`; refused for any other. */
  readerMonthlyBudget?: number | null;
  readerRequestsPerMonth?: number | null;
}

export type UpdateAiBudgetRequest = Partial<AiBudgetSettings>;

export interface AiBudgetState {
  month: string;
  monthlyBudget: number | null;
  spentMicros: number;
  reservedMicros: number;
  /** Spent over budget, 0 to 1 and beyond; null without a budget. */
  used: number | null;
  warning: boolean;
  exhausted: boolean;
  buildsPerMonth: number | null;
  buildsThisMonth: number;
  /** True when a slot in use has no prices, so builds per month is the limit that applies. */
  countsBuilds: boolean;
}

export interface AiOverview {
  encryptionConfigured: boolean;
  month: { month: string; requests: number; errors: number; costMicros: number; unknownCostRequests: number };
  budget: AiBudgetState;
  failingConnections: Array<{ id: number; name: string; failingSince: string; code: AiFailureCode | null; reason: string | null }>;
  failingSlots: Array<{ slot: AiSlot; failingSince: string; code: AiFailureCode; reason: string; model: string }>;
}

/** What one `ai_usage` row records as the attempt's outcome. `error:<code>` carries an {@link AiErrorCode}. */
export type AiUsageOutcome = "ok" | "refused" | "filtered" | "length" | "rate-limited" | "timeout" | "invalid-json" | `error:${string}`;

export interface AiUsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  costMicros: number;
  unknownCostRequests: number;
  errors: number;
}

export interface AiUsageMonth extends AiUsageTotals {
  month: string;
}

export interface AiUsageByFeature extends AiUsageTotals {
  feature: string;
}

export interface AiUsageByModel extends AiUsageTotals {
  model: string;
  connectionId: number | null;
  connectionName: string | null;
}

export interface AiUsageJob {
  jobId: string;
  feature: string;
  requests: number;
  costMicros: number;
  /** What the job was for, such as a book's title, when the feature can still name it. */
  label: string | null;
}

export interface AiUsageError {
  at: string;
  feature: string;
  slot: string;
  model: string;
  outcome: string;
  connectionId: number | null;
}

export interface AiUsageReport {
  from: string;
  to: string;
  months: AiUsageMonth[];
  byFeature: AiUsageByFeature[];
  byModel: AiUsageByModel[];
  costliestJobs: AiUsageJob[];
  recentErrors: AiUsageError[];
}

export interface AiTryRequest {
  slot: AiSlot;
}

export interface AiTryResult {
  slot: AiSlot;
  model: string;
  /** The story-guide slots' result; empty on the Vision slot. */
  names: Array<{ name: string; kind: string; description: string }>;
  /** The Vision slot's result: the books read in the sample picture. */
  books?: Array<{ title: string; author: string | null }>;
  durationMs: number;
  usage: { input: number; output: number; reasoning?: number };
  /** Null when the slot has no prices. */
  costMicros: number | null;
  jsonSupport: AiJsonSupport;
}

/** Error codes the admin routes return in `errorCode`, so the page can say what to do. */
export const AI_ADMIN_ERROR_CODES = [
  "AI_ENCRYPTION_KEY_MISSING",
  "AI_INVALID_URL",
  "AI_CONNECTION_NAME_TAKEN",
  "AI_CONNECTION_IN_USE",
  "AI_PRIVACY_CONFIRMATION_REQUIRED",
  "AI_SLOT_EMPTY",
  "AI_TRY_FAILED",
  "AI_PROVIDER_FAILED",
] as const;
export type AiAdminErrorCode = (typeof AI_ADMIN_ERROR_CODES)[number];

/**
 * `errorMeta` of `AI_CONNECTION_IN_USE`, so the delete dialog can name what holds the connection.
 * Error metadata carries scalars only, so the slots are joined.
 */
export interface AiConnectionInUse {
  /** The slots using the connection, comma separated; empty when none does. */
  slots: string;
  unfinishedJobs: number;
}

/** `errorMeta` of `AI_TRY_FAILED`: the client's code, and the failure and provider's words when known. */
export interface AiTryFailure {
  /** `refused` when the model declined the sample passage. */
  code: AiErrorCode | "refused";
  failure?: AiFailureCode;
  providerMessage?: string;
}

/** Codes `AiError` carries; jobs pause or skip a unit by these. */
export const AI_ERROR_CODES = [
  "off",
  "slot-empty",
  "budget",
  "provider-auth",
  "model-missing",
  "provider-down",
  "invalid-json",
  "too-long",
  "bad-request",
  "cancelled",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
