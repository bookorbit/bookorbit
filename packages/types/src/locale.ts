export const SUPPORTED_LOCALES = ["en", "de", "es", "fr", "it", "nl", "pl", "pt", "sl"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Native display names for each supported locale, shown in the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
  pt: "Português",
  sl: "Slovenščina",
};

export const LOCALE_DIRECTIONS: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  de: "ltr",
  es: "ltr",
  fr: "ltr",
  it: "ltr",
  nl: "ltr",
  pl: "ltr",
  pt: "ltr",
  sl: "ltr",
};

export interface LocalePreferences {
  locale: Locale;
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
