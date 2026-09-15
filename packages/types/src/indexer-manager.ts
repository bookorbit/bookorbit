import type { IndexerColor } from "./indexer";
import type { NetworkProfile } from "./network-profile";

export const INDEXER_MANAGER_TYPES = ["prowlarr"] as const;
export type IndexerManagerType = (typeof INDEXER_MANAGER_TYPES)[number];

export interface IndexerManagerSourceItem {
  id: number;
  externalId: string;
  name: string;
  color: IndexerColor | null;
  implementation: string | null;
  protocol: "torrent" | "usenet";
  adapterType: "torznab" | "newznab";
  enabled: boolean;
  available: boolean;
  priority: number | null;
  lastSeenAt: string | null;
  lastSearchAt: string | null;
  lastSearchOk: boolean | null;
  lastSearchError: string | null;
}

export interface IndexerManagerItem {
  id: number;
  name: string;
  color: IndexerColor | null;
  type: IndexerManagerType;
  enabled: boolean;
  baseUrl: string;
  hasCredential: boolean;
  allowPrivateAddress: boolean;
  syncNewIndexers: boolean;
  perIndexerTimeoutSeconds: number;
  overallSearchBudgetSeconds: number;
  autoExpandCategories: boolean;
  inheritSeedLimits: boolean;
  networkProfile: NetworkProfile | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastErrorMessage: string | null;
  lastSyncedAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
  version: string | null;
  sources: IndexerManagerSourceItem[];
  createdAt: string;
  updatedAt: string;
}

export interface IndexerManagerListResult {
  managers: IndexerManagerItem[];
  encryptionConfigured: boolean;
}

export interface CreateIndexerManagerPayload {
  name: string;
  type: IndexerManagerType;
  baseUrl: string;
  color?: IndexerColor | null;
  credential: string;
  enabled?: boolean;
  allowPrivateAddress?: boolean;
  syncNewIndexers?: boolean;
  perIndexerTimeoutSeconds?: number;
  overallSearchBudgetSeconds?: number;
  autoExpandCategories?: boolean;
  inheritSeedLimits?: boolean;
  networkProfile?: NetworkProfile | null;
}

export type UpdateIndexerManagerPayload = Partial<Omit<CreateIndexerManagerPayload, "type">>;

export interface UpdateIndexerManagerSourcePayload {
  enabled?: boolean;
  color?: IndexerColor | null;
}

export interface IndexerManagerTestResult {
  success: boolean;
  version?: string;
  sourceCount?: number;
  error?: string;
}

export interface IndexerManagerSyncResult {
  manager: IndexerManagerItem;
  discovered: number;
  created: number;
  updated: number;
  unavailable: number;
}
