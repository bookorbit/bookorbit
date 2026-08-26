/**
 * Language codes shared by the release matcher and by anything that has to offer a language to
 * choose from.
 *
 * Here rather than in the server, because the two have to agree exactly. A request states a
 * language, the matcher compares every release against it as a hard filter, and a picker offers
 * the choice: if the offered list and the comparable set ever drift apart, a user picks a language
 * that silently matches nothing and the request comes back empty for a book that is right there.
 */

/**
 * Three-letter codes that do not simply truncate to their two-letter form.
 *
 * Sources state either. A metadata provider writes "spa" where a request states "es", and
 * truncating "spa" to "sp" would hard-filter out every Spanish release. Both the bibliographic and
 * terminological variants are listed, since sources use either.
 */
export const ISO_639_2_TO_1: Record<string, string> = {
  alb: "sq",
  sqi: "sq",
  ara: "ar",
  arm: "hy",
  hye: "hy",
  baq: "eu",
  eus: "eu",
  ben: "bn",
  bul: "bg",
  bur: "my",
  mya: "my",
  cat: "ca",
  chi: "zh",
  zho: "zh",
  cze: "cs",
  ces: "cs",
  dan: "da",
  dut: "nl",
  nld: "nl",
  est: "et",
  fin: "fi",
  geo: "ka",
  kat: "ka",
  ger: "de",
  deu: "de",
  gre: "el",
  ell: "el",
  heb: "he",
  hin: "hi",
  hrv: "hr",
  hun: "hu",
  ice: "is",
  isl: "is",
  ind: "id",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  lav: "lv",
  lit: "lt",
  mac: "mk",
  mkd: "mk",
  mao: "mi",
  mri: "mi",
  may: "ms",
  msa: "ms",
  nor: "no",
  per: "fa",
  fas: "fa",
  pol: "pl",
  por: "pt",
  rum: "ro",
  ron: "ro",
  rus: "ru",
  slo: "sk",
  slk: "sk",
  slv: "sl",
  spa: "es",
  srp: "sr",
  swe: "sv",
  tha: "th",
  tib: "bo",
  bod: "bo",
  tur: "tr",
  ukr: "uk",
  vie: "vi",
  wel: "cy",
  cym: "cy",
};

/**
 * Languages that never needed a mapping, because their three-letter form truncates to the right
 * two letters on its own. Listed because the map is not a catalogue of supported languages, only of
 * the awkward ones, so deriving the offered list from it alone would omit these.
 */
const SELF_TRUNCATING_CODES = ["en", "fr", "af", "ga", "gl", "la", "nn", "sw", "ta", "te", "ur", "bs", "eo", "lb", "mt", "nb"];

/** The two-letter codes offered when choosing a language. */
export const REQUEST_LANGUAGE_CODES: readonly string[] = [...new Set([...Object.values(ISO_639_2_TO_1), ...SELF_TRUNCATING_CODES])].sort();

/** Compares only the language subtag, so "en" and "eng" and "en-GB" all agree. */
export function normalizeLanguage(value: string): string {
  const subtag = value.toLowerCase().split(/[-_]/)[0];
  return ISO_639_2_TO_1[subtag] ?? subtag.slice(0, 2);
}

/** Whether a release's stated language is one the request can accept. */
export function languagesAgree(requested: string, released: string): boolean {
  return normalizeLanguage(requested) === normalizeLanguage(released);
}

/**
 * A language as a code the request can carry, or null.
 *
 * Deliberately not restricted to `REQUEST_LANGUAGE_CODES`. That list is what a person is *offered*,
 * and it is curated; this is what a *provider* may already have stated. Narrowing here to the
 * offered list would silently drop the language from any request for a book in something the
 * dropdown happens not to list, turning a filter the matcher handled perfectly well into no filter
 * at all. Anything that normalises to a plausible subtag is kept, and the matcher compares it the
 * same way it always did.
 */
export function toRequestLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = normalizeLanguage(value.trim());
  return /^[a-z]{2}$/.test(code) ? code : null;
}
