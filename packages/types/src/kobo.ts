export interface KoboDevice {
  id: number;
  name: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface KoboDeviceWithToken extends KoboDevice {
  token: string;
}

export interface KoboSyncSettings {
  readingThreshold: number;
  finishedThreshold: number;
  convertToKepub: boolean;
  forceEnableHyphenation: boolean;
  kepubConversionLimitMb: number;
  twoWayProgressSync: boolean;
  syncBookOrbitAnnotationsToKobo: boolean;
}

export type KoboSyncHistoryEvent = "library_sync" | "book_download" | "progress_update" | "annotations_pull" | "annotations_push";

export type KoboSyncHistoryStatus = "success" | "failed";

export type KoboSyncHistoryCounts = Record<string, number | boolean | string | null>;

export interface KoboSyncHistoryEntry {
  id: number;
  deviceId: number | null;
  deviceName: string | null;
  event: KoboSyncHistoryEvent;
  status: KoboSyncHistoryStatus;
  counts: KoboSyncHistoryCounts;
  durationMs: number;
  errorClass: string | null;
  error: string | null;
  createdAt: string;
}

export interface CreateKoboDeviceRequest {
  name: string;
}

export interface RenameKoboDeviceRequest {
  name: string;
}

export interface UpdateKoboSyncSettingsRequest {
  readingThreshold?: number;
  finishedThreshold?: number;
  convertToKepub?: boolean;
  forceEnableHyphenation?: boolean;
  kepubConversionLimitMb?: number;
  twoWayProgressSync?: boolean;
  syncBookOrbitAnnotationsToKobo?: boolean;
}
