export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';
export type FontStyle = 'normal' | 'italic';

export interface UserFont {
  id: number;
  familyName: string;
  originalFileName: string;
  format: FontFormat;
  weight: number;
  style: FontStyle;
  fileSize: number;
  createdAt: string;
}

export interface FontUploadResult {
  font: UserFont;
  suggestedFamilyName: string | null;
  suggestedWeight: number;
  suggestedStyle: FontStyle;
}

export const FONT_FORMATS: readonly FontFormat[] = ['ttf', 'otf', 'woff', 'woff2'];

export const FONT_FORMAT_EXTENSIONS: Record<FontFormat, string> = {
  ttf: '.ttf',
  otf: '.otf',
  woff: '.woff',
  woff2: '.woff2',
};

export const FONT_FORMAT_MIME_TYPES: Record<FontFormat, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export const FONT_FORMAT_CSS_FORMAT: Record<FontFormat, string> = {
  ttf: 'truetype',
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
};

export const MAX_FONT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_FONTS_PER_USER = 50;

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export function fontCssFamilyName(fontId: number): string {
  return `__userfont_${fontId}`;
}

/**
 * Returns a stable, CSS-safe font-family name shared by all variants of a family.
 * Using one name per family (differentiated by font-weight/font-style) lets the
 * browser pick bold/italic variants automatically.
 */
export function fontCssFamilyGroupName(familyName: string): string {
  const safe = familyName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'font';
  return `__userfont_${safe}`;
}
