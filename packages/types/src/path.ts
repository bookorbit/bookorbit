export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface PathConfig {
  root: string;
}

export interface CreateFolderRequest {
  parentPath: string;
  name: string;
}

export type CreateFolderResult = DirectoryEntry;

/** Why a folder could or could not be read. `blocked` is a system path BookOrbit never opens. */
export type FolderState = "ok" | "denied" | "missing" | "blocked";

export interface FolderListingEntry extends DirectoryEntry {
  /** On a different filesystem than its parent: a Docker volume, a NAS share. */
  mount: boolean;
  /** An operating-system folder directly under `/` (bin, usr...), hidden unless asked for. */
  system: boolean;
  /** BookOrbit's own data folder (covers, caches, plugins). */
  appData: boolean;
  /** Whether it holds any listable folder. Null when the parent was too large to check every child. */
  hasChildren: boolean | null;
}

export interface FolderListing {
  path: string;
  state: FolderState;
  entries: FolderListingEntry[];
  /** Only the first folders by name are listed; the rest are reached by typing a path or finding. */
  truncated: boolean;
}

/** `pending`: the request's time ran out before this folder was walked; ask for it again. */
export type FolderSummaryState = FolderState | "pending";

/**
 * Counts for one folder from a walk that stops at a fixed number of entries. When `truncated` is
 * true every count is a lower bound.
 */
export interface FolderSummary {
  path: string;
  state: FolderSummaryState;
  /** Book files: what File as Book would import. */
  files: number;
  /** Books as Folder as Book: one per file directly inside, plus one per folder below holding book files. */
  folderBooks: number;
  /** Book files per format, keyed by lower-case extension. */
  formats: Record<string, number>;
  /** Folders directly inside. */
  folders: number;
  /** Folders below holding several differently named books, which Folder as Book reads as one. */
  mergedFolders: number;
  /** Folders below holding several audio files, which File as Book reads as one book each. */
  splitAudioFolders: number;
  truncated: boolean;
}

export interface FolderSummariesRequest {
  paths: string[];
}

export interface FolderInspection extends FolderSummary {
  /** Size of the book files counted. */
  bytes: number;
  /** The first book files found, relative to the folder. */
  samples: string[];
}

export interface FolderSearchResult {
  results: string[];
  truncated: boolean;
}

export interface FolderPickerLibrary {
  id: number;
  name: string;
  icon: string | null;
  folders: string[];
}

export interface FolderPlaces {
  root: string;
  /** Folders on their own filesystem near the browse root. */
  mounts: string[];
  /** BookOrbit's data folder when it is inside the browse root. */
  appDataPath: string | null;
  /** Every library and the folders it reads, for landmarks and overlap checks. */
  libraries: FolderPickerLibrary[];
}

export interface UnclaimedFolder {
  path: string;
  files: number;
  formats: Record<string, number>;
}

export interface UnclaimedFolders {
  folders: UnclaimedFolder[];
  truncated: boolean;
}
