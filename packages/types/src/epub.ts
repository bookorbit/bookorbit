export interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string[];
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
