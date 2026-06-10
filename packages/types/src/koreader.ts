export interface KoreaderCredentials {
  username: string;
  syncEnabled: boolean;
  createdAt: string;
}

export interface KoreaderDeviceInfo {
  device: string;
  deviceId: string;
  lastSyncAt: string;
  lastBookTitle: string | null;
}

export interface KoreaderBookProgress {
  device: string;
  deviceId: string;
  percentage: number;
  chapterIndex: number | null;
  chapterTitle: string | null;
  updatedAt: string;
}

export interface KoreaderDeviceSweepInfo {
  deviceId: string;
  deviceModel: string;
  pluginVersion: string | null;
  lastSweepAt: string;
  lastSweepBooksMatched: number;
  lastSweepPageStats: number;
  lastSweepAnnotations: number;
}

export interface KoreaderPluginTotals {
  matchedBooks: number;
  pageStatEvents: number;
  annotations: number;
}

export interface KoreaderSyncStatus {
  credentials: KoreaderCredentials | null;
  devices: KoreaderDeviceInfo[];
  totalSyncedBooks: number;
  lastSyncAt: string | null;
  sweeps: KoreaderDeviceSweepInfo[];
  pluginTotals: KoreaderPluginTotals;
}

export interface KoreaderAnnotationItem {
  id: number;
  drawer: "lighten" | "underscore" | "strikeout" | "invert";
  color: string | null;
  text: string | null;
  note: string | null;
  chapter: string | null;
  pageno: number | null;
  posFormat: "xpointer" | "pdf";
  deviceCreatedAt: string;
  deviceUpdatedAt: string | null;
}

export interface KoreaderBookSyncInfo {
  bookId: number;
  bookFileId: number;
  canonicalPercentage: number;
  canonicalChapterIndex: number | null;
  canonicalChapterTitle: string | null;
  canonicalSource: "koreader" | "web_reader";
  canonicalUpdatedAt: string;
  devices: KoreaderBookProgress[];
  fileModifiedSinceLastSync: boolean;
}

export interface CreateKoreaderCredentialsPayload {
  username: string;
  password: string;
}

export interface UpdateKoreaderCredentialsPayload {
  username?: string;
  password?: string;
  syncEnabled?: boolean;
}

export interface TestKoreaderConnectionResult {
  success: boolean;
  username: string;
  serverUrl: string;
}
