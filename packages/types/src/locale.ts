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
