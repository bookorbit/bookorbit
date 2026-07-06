export const SUPPORTED_LOCALES = ["en", "nl", "de", "sl"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Native display names for each supported locale, shown in the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  nl: "Nederlands",
  de: "Deutsch",
  sl: "Slovenščina",
};

export interface LocalePreferences {
  locale: Locale;
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
