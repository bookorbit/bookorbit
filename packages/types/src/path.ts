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
