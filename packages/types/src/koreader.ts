export interface KoreaderCredentials {
  username: string;
  syncEnabled: boolean;
  discardBackwardProgress: boolean;
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

export interface KoreaderSyncStatus {
  credentials: KoreaderCredentials | null;
  devices: KoreaderDeviceInfo[];
  totalSyncedBooks: number;
  lastSyncAt: string | null;
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
  discardBackwardProgress?: boolean;
}

export interface TestKoreaderConnectionResult {
  success: boolean;
  username: string;
  serverUrl: string;
}
