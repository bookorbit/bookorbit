export const SUPPORTED_LOCALES = ["en", "nl"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Native display names for each supported locale, shown in the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  nl: "Nederlands",
};

export interface LocalePreferences {
  locale: Locale;
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
