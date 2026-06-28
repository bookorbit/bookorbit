export const CUSTOM_ICON_PREFIX = "custom:";
export const CUSTOM_ICON_SLUG_MAX_LENGTH = 80;
export const CUSTOM_ICON_NAME_MAX_LENGTH = 120;
export const ICON_VALUE_MAX_LENGTH = 100;
export const CUSTOM_ICON_MAX_FILE_SIZE = 128 * 1024;
export const CUSTOM_ICON_MAX_UPLOAD_FILES = 50;
export const CUSTOM_ICON_DEFAULT_PAGE_SIZE = 48;
export const CUSTOM_ICON_MAX_PAGE_SIZE = 100;
export const CUSTOM_ICON_CATALOG_LIMIT = 500;

export const CUSTOM_ICON_SORTS = ["newest", "name"] as const;
export type CustomIconSort = (typeof CUSTOM_ICON_SORTS)[number];

export interface CustomIcon {
  slug: string;
  name: string;
  svgUrl: string;
  fileHash: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomIconPage {
  items: CustomIcon[];
  total: number;
  page: number;
  size: number;
}

export interface CustomIconCatalog {
  items: CustomIcon[];
  total: number;
}

export interface CustomIconUsage {
  total: number;
  libraries: number;
  collections: number;
  smartScopes: number;
}

export interface CustomIconStageItem {
  filename: string;
  ok: boolean;
  error?: string;
  suggestedName?: string;
  sanitizedSvg?: string;
  fileHash?: string;
  duplicateOfSlug?: string;
  duplicateOfName?: string;
}

export interface CustomIconStageResponse {
  items: CustomIconStageItem[];
}

export interface CustomIconUploadMetaItem {
  filename: string;
  name: string;
}

export interface CustomIconUploadItem {
  filename: string;
  status: "created" | "failed";
  icon?: CustomIcon;
  error?: string;
}

export interface CustomIconUploadResponse {
  items: CustomIconUploadItem[];
}

export interface BulkDeleteCustomIconsRequest {
  slugs: string[];
}

export interface BulkDeleteCustomIconsResponse {
  deleted: string[];
  failed: string[];
}

export function isCustomIconValue(value: string | null | undefined): value is `custom:${string}` {
  return typeof value === "string" && value.startsWith(CUSTOM_ICON_PREFIX) && value.length > CUSTOM_ICON_PREFIX.length;
}

export function customIconSlugFromValue(value: string | null | undefined): string | null {
  return isCustomIconValue(value) ? value.slice(CUSTOM_ICON_PREFIX.length) : null;
}

export function customIconValue(slug: string): `custom:${string}` {
  return `${CUSTOM_ICON_PREFIX}${slug}`;
}

export function customIconSvgUrl(slug: string): string {
  return `/api/v1/custom-icons/${slug}.svg`;
}

export function slugifyIconName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CUSTOM_ICON_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function isValidIconSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= CUSTOM_ICON_SLUG_MAX_LENGTH;
}
