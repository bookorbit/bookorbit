export interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string[];
  mediaOverlay?: string;
  size: number;
}

export interface EpubSpineItem {
  idref: string;
  href: string;
  mediaType: string;
  linear: boolean;
}

export interface EpubTocItem {
  label: string;
  href?: string;
  children?: EpubTocItem[];
}

export interface EpubBookInfo {
  containerPath: string;
  rootPath: string;
  spine: EpubSpineItem[];
  manifest: EpubManifestItem[];
  optionalFiles?: string[];
  toc: EpubTocItem | null;
  metadata: Record<string, unknown>;
  coverPath: string | null;
}

export interface EpubMediaOverlayCapability {
  available: boolean;
  durationSeconds: number | null;
}

export interface EpubMediaOverlayPlaylistItem {
  index: number;
  sectionIndex: number;
  smilHref: string;
  textHref: string;
  textFragment: string | null;
  audioHref: string;
  audioMimeType: string;
  clipBeginSeconds: number;
  clipEndSeconds: number | null;
  durationSeconds: number | null;
  label: string | null;
}

export interface EpubMediaOverlayPlaylistSection {
  index: number;
  href: string;
  label: string | null;
  smilHref: string;
  startSeconds: number;
  durationSeconds: number | null;
}

export interface EpubMediaOverlayPlaylistResource {
  href: string;
  mediaType: string;
  size: number;
}

export interface EpubMediaOverlayPlaylist {
  bookId: number;
  fileId: number | null;
  durationSeconds: number | null;
  items: EpubMediaOverlayPlaylistItem[];
  sections: EpubMediaOverlayPlaylistSection[];
  resources: EpubMediaOverlayPlaylistResource[];
}
