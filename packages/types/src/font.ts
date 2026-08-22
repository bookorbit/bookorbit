export type FontFormat = "ttf" | "otf" | "woff" | "woff2";
export type FontStyle = "normal" | "italic";

/**
 * Where a font comes from. `user` fonts are uploaded by and visible to a single
 * account; `server` fonts are curated by an administrator and offered to everyone.
 */
export type FontScope = "user" | "server";

export const FONT_SCOPES: readonly FontScope[] = ["user", "server"];

/** One selectable style within a family: a weight paired with an upright/italic axis. */
export interface FontVariant {
  weight: number;
  style: FontStyle;
}

/**
 * A style a variable font advertises through its `fvar` named instances, carrying the
 * designer's own name for it ("SemiBold Italic") rather than one derived from the weight.
 */
export interface FontNamedInstance extends FontVariant {
  /**
   * The designer's own name for the instance. Null when the font did not name it, which
   * leaves the reader to label it from the weight in the reader's own language.
   */
  name: string | null;
}

export interface UserFont {
  id: number;
  familyName: string;
  originalFileName: string;
  format: FontFormat;
  /** The face this file renders by default. For a variable font, its default instance. */
  weight: number;
  style: FontStyle;
  /**
   * Bounds of the file's `wght` variation axis, or null for a static face. A variable
   * font declares these in `@font-face` so every weight in the range renders from the
   * real axis instead of being synthesised from the default instance.
   */
  weightMin: number | null;
  weightMax: number | null;
  /** Styles a variable file advertises by name. Null for a static face. */
  instances: FontNamedInstance[] | null;
  fileSize: number;
  createdAt: string;
}

/** Server fonts are wire-identical to user fonts; only their scope differs. */
export type ServerFont = UserFont;

export interface FontUploadResult {
  font: UserFont;
  suggestedFamilyName: string | null;
  suggestedWeight: number;
  suggestedStyle: FontStyle;
}

export const FONT_FORMATS: readonly FontFormat[] = ["ttf", "otf", "woff", "woff2"];

export const FONT_FORMAT_EXTENSIONS: Record<FontFormat, string> = {
  ttf: ".ttf",
  otf: ".otf",
  woff: ".woff",
  woff2: ".woff2",
};

export const FONT_FORMAT_MIME_TYPES: Record<FontFormat, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export const FONT_FORMAT_CSS_FORMAT: Record<FontFormat, string> = {
  ttf: "truetype",
  otf: "opentype",
  woff: "woff",
  woff2: "woff2",
};

// Sized for CJK and other non-alphabetic fonts, which routinely exceed 30 MB because
// they carry tens of thousands of glyphs.
export const MAX_FONT_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_FONTS_PER_USER = 50;

// A curated server collection is typically 10-30 families of ~4 variants each. The cap
// exists so a single administrator cannot fill the data volume by accident.
export const MAX_SERVER_FONTS = 200;

export function maxFontsForScope(scope: FontScope): number {
  return scope === "server" ? MAX_SERVER_FONTS : MAX_FONTS_PER_USER;
}

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export const CSS_FONT_WEIGHT_MIN = 1;
export const CSS_FONT_WEIGHT_MAX = 1000;

export function isCssFontWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= CSS_FONT_WEIGHT_MIN && value <= CSS_FONT_WEIGHT_MAX;
}

export const FONT_FAMILY_NAME_MAX_LENGTH = 200;

/**
 * Per-user opt-outs from the server collection. Server fonts are offered to everyone by
 * default; a reader can hide the ones they do not want cluttering their font picker.
 *
 * Families are stored by name because that is the unit the picker offers. An administrator
 * renaming a family therefore un-hides it, which is the intended reading: it is presented
 * as a different typeface from that point on.
 */
export interface ServerFontPreferences {
  hiddenFamilies: string[];
}

export const SERVER_FONT_PREFERENCES_DEFAULTS: ServerFontPreferences = { hiddenFamilies: [] };

/**
 * CSS font-family prefixes, one per scope. They keep a user font and a server font
 * that share a family name from collapsing into a single `@font-face` group.
 *
 * The `user` prefix is persisted in saved reader settings, so it must not change.
 */
export const FONT_CSS_FAMILY_PREFIXES: Record<FontScope, string> = {
  user: "__userfont_",
  server: "__serverfont_",
};

/**
 * Returns a stable, CSS-safe font-family name shared by all variants of a family.
 * Using one name per family (differentiated by font-weight/font-style) lets the
 * browser pick bold/italic variants automatically.
 */
export function fontCssFamilyGroupName(familyName: string, scope: FontScope = "user"): string {
  const safe =
    familyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_") // codeql[js/polynomial-redos] - false positive: simple negated char class has no backtracking
      .replace(/^_+|_+$/g, "") || "font";
  return `${FONT_CSS_FAMILY_PREFIXES[scope]}${safe}`;
}

/** Returns the scope a CSS family name belongs to, or null for built-in font stacks. */
export function fontScopeFromCssFamily(cssFamilyName: string | null | undefined): FontScope | null {
  if (!cssFamilyName) return null;
  // Checked longest-prefix-first so the scopes stay distinguishable if a future
  // prefix is ever added that extends another.
  const byLength = [...FONT_SCOPES].sort((a, b) => FONT_CSS_FAMILY_PREFIXES[b].length - FONT_CSS_FAMILY_PREFIXES[a].length);
  return byLength.find((scope) => cssFamilyName.startsWith(FONT_CSS_FAMILY_PREFIXES[scope])) ?? null;
}

/** True when a reader `fontFamily` value refers to an uploaded font rather than a built-in stack. */
export function isCustomFontCssFamily(cssFamilyName: string | null | undefined): boolean {
  return fontScopeFromCssFamily(cssFamilyName) !== null;
}

/** True when the file carries a `wght` variation axis rather than a single static weight. */
export function isVariableFont(font: Pick<UserFont, "weightMin" | "weightMax">): boolean {
  return font.weightMin !== null && font.weightMax !== null && font.weightMax > font.weightMin;
}

/**
 * The styles a built-in font stack offers. Unlike an uploaded family there is no file
 * list to read, so the reader offers the four the browser can always produce from a
 * system stack.
 */
export const BUILT_IN_FONT_VARIANTS: readonly FontVariant[] = [
  { weight: 400, style: "normal" },
  { weight: 700, style: "normal" },
  { weight: 400, style: "italic" },
  { weight: 700, style: "italic" },
];

/** Orders variants the way a font picker reads: upright before italic, light before heavy. */
export function compareFontVariants(a: FontVariant, b: FontVariant): number {
  if (a.style !== b.style) return a.style === "normal" ? -1 : 1;
  return a.weight - b.weight;
}
