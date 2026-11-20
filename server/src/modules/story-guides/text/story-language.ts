/** Languages a story guide can be built in. */
export const STORY_GUIDE_LANGUAGES: readonly string[] = ['en', 'es'];

/** Stored for a book whose language neither its metadata nor its text decides. */
export const UNDETERMINED_LANGUAGE = 'und';

export function isStoryGuideLanguage(language: string | null | undefined): boolean {
  return !!language && STORY_GUIDE_LANGUAGES.includes(language);
}

const UNDETERMINED = new Set(['und', 'mul', 'zxx', 'mis', 'xx']);

const ISO_639_1 =
  'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu ' +
  'fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ' +
  'ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os ' +
  'pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ' +
  'ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu';

function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();
}

let languageNames: Map<string, string> | null = null;

/** Language names in English and in themselves, folded: "english", "francais", "deutsch". */
function namesToCodes(): Map<string, string> {
  if (languageNames) return languageNames;
  const names = new Map<string, string>();
  const english = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  for (const code of ISO_639_1.split(' ')) {
    const own = (() => {
      try {
        return new Intl.DisplayNames([code], { type: 'language', fallback: 'none' }).of(code);
      } catch {
        return undefined;
      }
    })();
    for (const name of [english.of(code), own]) {
      if (name) names.set(fold(name), code);
    }
  }
  languageNames = names;
  return names;
}

/**
 * A language tag or name as a two-letter code, as the app's `StoryLexicon.base` reads it: the
 * first subtag of a tag, three-letter codes (bibliographic ones too) to two letters, language
 * names in English or in themselves, and nothing for `und` and the other undetermined codes.
 */
export function normaliseLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const first = trimmed.split(/[-_]/)[0];
  if (!first || !/^\p{L}+$/u.test(first)) return null;
  if (UNDETERMINED.has(first)) return null;
  if (first.length === 2) return first;
  if (first.length === 3) {
    try {
      const canonical = Intl.getCanonicalLocales(first)[0]?.split('-')[0];
      return canonical && canonical.length === 2 ? canonical : first;
    } catch {
      return first;
    }
  }
  return namesToCodes().get(fold(trimmed)) ?? null;
}

/** The most common short words of each language the detector can tell apart, supported or not. */
const COMMON_WORDS: Record<string, readonly string[]> = {
  en: 'the and of to a in that is was he it his with as i you for had not but at on she her be have by which from they this were my me him'.split(
    ' ',
  ),
  fr: 'le la les de des et un une est que qui il elle dans ne pas pour sur au du avec son sa ses je vous nous était mais ce'.split(' '),
  de: 'der die das und ist nicht ein eine zu den dem mit sich auf ich er sie es war auch von im des dass aber wie wenn'.split(' '),
  es: 'el la los las de y que en un una es no se por con para su lo al del como pero más era yo le'.split(' '),
  it: 'il la di che e è non un una per con del della si le gli da ma come era sono io lui lei'.split(' '),
  nl: 'de het een en van is niet dat die ik je hij zij op te in met voor maar was er aan ook'.split(' '),
  pt: 'o a os as de e que não um uma do da em para com se por mais era ele ela'.split(' '),
};

const SAMPLE_SECTIONS = 3;
const SAMPLE_WORDS_PER_SECTION = 1500;
/** At least this share of the sample must be the winner's common words. */
const MIN_SHARE = 0.2;
/** And the winner must lead the runner-up by this factor. */
const MIN_LEAD = 1.5;
/** Below this share the text is not in a language the detector knows the words of. */
const FOREIGN_SHARE = 0.05;
const MIN_SAMPLE_WORDS = 50;

function sampleWords(sections: readonly string[]): string[] {
  const words: string[] = [];
  for (const text of sections.slice(0, SAMPLE_SECTIONS)) {
    const all = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
    const start = Math.max(0, Math.floor(all.length / 2) - SAMPLE_WORDS_PER_SECTION / 2);
    words.push(...all.slice(start, start + SAMPLE_WORDS_PER_SECTION));
  }
  return words;
}

function shares(words: readonly string[]): { code: string; share: number }[] {
  return Object.entries(COMMON_WORDS)
    .map(([code, list]) => {
      const set = new Set(list);
      return { code, share: words.filter((word) => set.has(word)).length / words.length };
    })
    .sort((a, b) => b.share - a.share);
}

/**
 * The language of the text by common words, over the middle of the first few story sections
 * (a title page or a contents list reads as almost any language). Null when no language clearly
 * wins.
 */
export function detectLanguage(sections: readonly string[]): string | null {
  const words = sampleWords(sections);
  if (words.length < MIN_SAMPLE_WORDS) return null;
  const [best, next] = shares(words);
  if (best.share < MIN_SHARE || best.share < next.share * MIN_LEAD) return null;
  return best.code;
}

/**
 * The book's language as a two-letter code: its metadata, unless the text clearly reads as another
 * language (a mislabelled book), and the text alone when the metadata names none. `und` when
 * neither decides. Whether a guide can be built in it is `isStoryGuideLanguage`.
 */
export function storyLanguage(metadata: readonly string[], sections: readonly string[]): string {
  const labelled = metadata.map(normaliseLanguage).find((code): code is string => code !== null) ?? null;
  const detected = detectLanguage(sections);
  if (detected) return detected;
  if (!labelled) return UNDETERMINED_LANGUAGE;
  if (COMMON_WORDS[labelled]) {
    // A label the text does not bear out at all, such as English metadata on a book in Russian.
    const words = sampleWords(sections);
    const labelledShare = shares(words).find((entry) => entry.code === labelled)?.share ?? 0;
    if (words.length >= MIN_SAMPLE_WORDS && labelledShare < FOREIGN_SHARE) return UNDETERMINED_LANGUAGE;
  }
  return labelled;
}
