export const SUPPORTED_LOCALES = [
  "en",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "fi",
  "fr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "zh",
  "zh-Hant",
] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Native display names for each supported locale, shown in the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  cs: "Čeština",
  da: "Dansk",
  de: "Deutsch",
  el: "Ελληνικά",
  es: "Español",
  fi: "Suomi",
  fr: "Français",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  nl: "Nederlands",
  pl: "Polski",
  pt: "Português",
  ro: "Română",
  ru: "Русский",
  sk: "Slovenčina",
  sl: "Slovenščina",
  sv: "Svenska",
  tr: "Türkçe",
  uk: "Українська",
  zh: "简体中文",
  "zh-Hant": "繁體中文",
};

export const LOCALE_DIRECTIONS: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  cs: "ltr",
  da: "ltr",
  de: "ltr",
  el: "ltr",
  es: "ltr",
  fi: "ltr",
  fr: "ltr",
  hu: "ltr",
  id: "ltr",
  it: "ltr",
  ja: "ltr",
  ko: "ltr",
  nl: "ltr",
  pl: "ltr",
  pt: "ltr",
  ro: "ltr",
  ru: "ltr",
  sk: "ltr",
  sl: "ltr",
  sv: "ltr",
  tr: "ltr",
  uk: "ltr",
  zh: "ltr",
  "zh-Hant": "ltr",
};

export interface LocalePreferences {
  locale: Locale;
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function canonicalizeLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The supported locale that best serves a ranked list of language tags, or null when none does.
 * An exact tag wins, then the same language and script (`zh-TW` and `zh-Hant-HK` both reach
 * `zh-Hant`), then the bare language (`pt-BR` reaches `pt`).
 */
export function matchSupportedLocale(candidates: readonly string[]): Locale | null {
  const supportedByCanonical = new Map<string, Locale>();
  const supportedByLanguageAndScript = new Map<string, Locale>();
  for (const locale of SUPPORTED_LOCALES) {
    const canonical = canonicalizeLocale(locale);
    if (!canonical) continue;
    supportedByCanonical.set(canonical.toLowerCase(), locale);
    const maximized = new Intl.Locale(canonical).maximize();
    if (maximized.script) {
      supportedByLanguageAndScript.set(`${maximized.language.toLowerCase()}-${maximized.script.toLowerCase()}`, locale);
    }
  }

  for (const candidate of candidates) {
    const canonical = canonicalizeLocale(candidate);
    if (!canonical) continue;
    const exact = supportedByCanonical.get(canonical.toLowerCase());
    if (exact) return exact;
    const maximized = new Intl.Locale(canonical).maximize();
    const language = maximized.language.toLowerCase();
    if (maximized.script) {
      const scriptMatch = supportedByLanguageAndScript.get(`${language}-${maximized.script.toLowerCase()}`);
      if (scriptMatch) return scriptMatch;
    }
    const baseLocale = supportedByCanonical.get(language);
    if (baseLocale) return baseLocale;
  }

  return null;
}

/**
 * The language tags of an `Accept-Language` header, most preferred first. The `*` wildcard and
 * tags weighted `q=0` are dropped; a weight that is not a number counts as 1, and equal weights
 * keep the order they were sent in.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  const entries: { tag: string; quality: number; index: number }[] = [];
  header.split(",").forEach((part, index) => {
    const [rawTag, ...parameters] = part.split(";");
    const tag = rawTag?.trim();
    if (!tag || tag === "*") return;
    let quality = 1;
    for (const parameter of parameters) {
      const [name, value] = parameter.split("=").map((piece) => piece.trim());
      if (name?.toLowerCase() !== "q") continue;
      const parsed = Number(value);
      quality = Number.isFinite(parsed) ? parsed : 1;
    }
    if (quality <= 0) return;
    entries.push({ tag, quality, index });
  });
  entries.sort((left, right) => right.quality - left.quality || left.index - right.index);
  return entries.map((entry) => entry.tag);
}

/** The supported locale an `Accept-Language` header asks for, or null when it names none. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  return matchSupportedLocale(parseAcceptLanguage(header));
}
