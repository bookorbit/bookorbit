import type { StoryGuideTieType } from '@bookorbit/types';

import { FAMILY_AND_ROLE_WORDS, HONORIFICS, HONORIFIC_ONLY, NAME_PREFIX_WORDS, NUMBER_ONLY, TITLES, WORD_CHAR, WORD_EDGE } from './name-text';

/**
 * The words and patterns the story guide's code checks read, by the book's language. English is
 * what every check was tuned on and stays exactly as it was. Another language keeps the English
 * words, since translations keep "Mr. Holmes" and the like, adds its own, and swaps the patterns
 * that only fit English text.
 */
export interface StoryLexicon {
  language: string;
  /** The language's English name for a prompt ("Spanish"); null for English, whose prompts say nothing. */
  writeIn: string | null;
  titles: ReadonlySet<string>;
  namePrefixWords: ReadonlySet<string>;
  honorificOnly: ReadonlySet<string>;
  honorifics: ReadonlySet<string>;
  familyAndRoleWords: ReadonlySet<string>;
  /** A name made only of these is never a person ("Mom", "the Doctor"), unless it has another name. */
  roleOnly: ReadonlySet<string>;
  calendar: ReadonlySet<string>;
  /** A non-character entry named only by these is dropped ("The", "And"). */
  connectives: ReadonlySet<string>;
  numberOnly: RegExp;
  /** "House X": the words that make a group a house. */
  houseWords: readonly string[];
  /** The names checklist: capitalised runs, sentence starts, everyday words, and runs that are never names. */
  run: RegExp;
  sentenceStart: RegExp;
  lowerWord: RegExp;
  pronounRuns: ReadonlySet<string>;
  /** First-person narration: dialogue to leave out, then first- and third-person pronouns. */
  dialogue: RegExp;
  firstPerson: RegExp;
  thirdPerson: RegExp;
  /** Lines, profiles and summaries. */
  narrator: RegExp;
  hedge: RegExp;
  placeholder: RegExp;
  /** Ties. */
  kinTitle: RegExp;
  familyWords: RegExp;
  possessiveKin: RegExp;
  elderTitle: Partial<Record<StoryGuideTieType, RegExp>>;
  tieStop: ReadonlySet<string>;
  firstPersonWords: readonly string[];
  nameToken: RegExp;
  quoteEdgeChars: string;
  /** A name word as names are compared: Spanish spells one name with and without its accents ("Cárlos", "Carlos"). */
  nameFold: (word: string) => string;
}

function anyCase(word: string): string {
  return [...word].map((char) => `[${char}${char.toUpperCase()}]`).join('');
}

function words(list: string): string[] {
  return list.split(/\s+/u).filter(Boolean);
}

const EN_KIN_WORDS = words('aunt aunty auntie uncle cousin gran granny grandma grandpa nan nana');
const EN_FAMILY =
  `father|mother|fathers|mothers|parents?|son|sons|daughters?|child|children|kids?|brothers?|sisters?|siblings?|` +
  `twins?|aunt|aunts|aunty|auntie|uncles?|nieces?|nephews?|cousins?|wife|wives|husbands?|married|marry|marriage|wed|` +
  `wedded|wedding|widow|widower|betrothed|betrothal|engaged|engagement|fianc[eé]e?|bride|groom|promised|` +
  `grand${WORD_CHAR}*|great-${WORD_CHAR}+|step${WORD_CHAR}+|half-${WORD_CHAR}+|${WORD_CHAR}+-in-law|mum|mom|mommy|mummy|dad|daddy|da|ma|pa|papa|mama|family|` +
  `kin|kinsman|kinswoman|related|relatives?|relation|heir|firstborn|eldest|youngest`;
const EN_POSSESSIVE_KIN =
  `${WORD_EDGE}(?:his|her|my|your|their|our|${WORD_CHAR}+'s)\\s+(?:great[- ]|grand[- ]?)*(?:aunt|aunty|auntie|` +
  `uncle|cousin|gran|granny|grandma|grandpa|grandmother|grandfather|nan|nana)${WORD_EDGE}`;
const EN_AUNT_OR_UNCLE = '(?:great[- ])*(?:aunt|aunty|auntie|uncle)';
const EN_GRANDPARENT = '(?:great[- ])*(?:gran|granny|grandma|grandpa|grandmother|grandfather|nan|nana)';
const EN_FIRST_PERSON_WORDS = ['i', 'my', 'me', 'mine', 'myself', "i'm", "i've", "i'd", "i'll"];
const EN_HONORIFIC_PREFIX = 'Mr|Mrs|Ms|Dr|St';
// Dashes as escapes: the source holds no em dash characters.
const EN_QUOTE_EDGE_CHARS = '"\'.,;:!?…\u2014\u2013-()';

const EN_ROLE_ONLY = new Set([...FAMILY_AND_ROLE_WORDS, ...words('mommy daddy mummy granny gran nana grandmother grandfather auntie the my old')]);
const EN_CALENDAR = new Set(
  words(
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december',
  ),
);

function capitalRun(prefixes: string, capital: string): RegExp {
  const prefix = `(?:(?:${prefixes})\\. )?`;
  const word = `${capital}[\\p{L}\\p{N}_’'-]*`;
  return new RegExp(`${prefix}${word}(?: ${prefix}${word})*`, 'gu');
}

export const ENGLISH_STORY_LEXICON: StoryLexicon = {
  language: 'en',
  writeIn: null,
  titles: TITLES,
  namePrefixWords: NAME_PREFIX_WORDS,
  honorificOnly: HONORIFIC_ONLY,
  honorifics: HONORIFICS,
  familyAndRoleWords: FAMILY_AND_ROLE_WORDS,
  roleOnly: EN_ROLE_ONLY,
  calendar: EN_CALENDAR,
  connectives: new Set(['the', 'and']),
  numberOnly: NUMBER_ONLY,
  houseWords: ['house'],
  run: capitalRun(EN_HONORIFIC_PREFIX, '[A-Z]'),
  sentenceStart: /(?:^|[.!?…]["”’]?\s+|["“]\s*)\n?$/u,
  lowerWord: new RegExp(`(?<!${WORD_CHAR})[a-z][\\p{L}\\p{N}_’'-]*`, 'gu'),
  pronounRuns: new Set(['I', 'I’m', 'I’ve', 'I’ll', 'I’d', 'Mr', 'Mrs']),
  dialogue: /“[^”]*”|"[^"\n]*"/gu,
  firstPerson: new RegExp(
    `${WORD_EDGE}I${WORD_EDGE}|${WORD_EDGE}I[’'](?:m|d|ll|ve)${WORD_EDGE}|${WORD_EDGE}(?:[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)${WORD_EDGE}`,
    'gu',
  ),
  thirdPerson: new RegExp(`${WORD_EDGE}(?:he|she|him|her|his|hers|himself|herself)${WORD_EDGE}`, 'giu'),
  narrator: new RegExp(`${WORD_EDGE}the narrator${WORD_EDGE}`, 'iu'),
  hedge: new RegExp(`${WORD_EDGE}or${WORD_EDGE}`, 'iu'),
  placeholder: /^(?:none|unknown|n\/?a|no (?:identity )?line|not (?:stated|known))$/iu,
  kinTitle: new RegExp(`${WORD_EDGE}(?:${EN_KIN_WORDS.map(anyCase).join('|')})\\s+[A-Z]`, 'u'),
  familyWords: new RegExp(`${WORD_EDGE}(?:${EN_FAMILY})${WORD_EDGE}`, 'iu'),
  possessiveKin: new RegExp(EN_POSSESSIVE_KIN, 'iu'),
  elderTitle: {
    aunt_or_uncle_of: new RegExp(`^${EN_AUNT_OR_UNCLE}${WORD_EDGE}`, 'iu'),
    grandparent_of: new RegExp(`^${EN_GRANDPARENT}${WORD_EDGE}`, 'iu'),
  },
  tieStop: new Set([...HONORIFICS, ...FAMILY_AND_ROLE_WORDS, 'the', 'of', 'and', 'mr', 'mrs', 'ms', 'miss']),
  firstPersonWords: EN_FIRST_PERSON_WORDS,
  nameToken: /[A-Za-z][\p{L}\p{N}_']*/gu,
  quoteEdgeChars: EN_QUOTE_EDGE_CHARS,
  nameFold: (word) => word,
};

// Spanish. Words are given with and without accents, since older texts and OCR drop them.
const ES_TITLES = words(
  'señor señora señorita senor senora senorita sr sra srta don doña dona dña dª d fray sor san santo santa rey reina ' +
    'príncipe principe princesa infante infanta duque duquesa marqués marques marquesa conde condesa barón baron baronesa ' +
    'vizconde vizcondesa capitán capitan coronel general comandante teniente padre madre hermano hermana tío tio tía tia ' +
    'primo prima abuelo abuela maestro maestra amo ama doctor doctora dr dra casa el la los las de del y joven viejo vieja gran',
);
const ES_NAME_PREFIX_WORDS = words(
  'detective inspector inspectora comisario comisaria agente oficial sargento cabo juez jueza alcalde alcaldesa presidente ' +
    'presidenta senador senadora ministro ministra profesor profesora doctor doctora enfermero enfermera reverendo cura ' +
    'párroco parroco obispo arzobispo cardenal emperador emperatriz jefe jefa licenciado abogado notario médico medico ' +
    'nuestro nuestra mi pequeño pequeña pequeno pequena',
);
const ES_HONORIFIC_ONLY = words(
  'majestad alteza excelencia señoría señoria usía usia vuecencia merced vuesa vuestra vuestro su sus usted ustedes ' +
    'ilustrísima ilustrisima eminencia santidad reverencia guardia guardias',
);
const ES_HONORIFICS = words(
  'señor señora señorita senor senora senorita sr sra srta don doña dona dña d dr dra doctor doctora profesor profesora tío tía tio tia',
);
const ES_FAMILY_AND_ROLE_WORDS = words(
  'padre madre papá mamá papaíto mamaíta abuelo abuela abuelito abuelita tío tía tio tia hijo hija hermano hermana ' +
    'señor señora señorita senor senora rey reina príncipe principe princesa general coronel doctor doctora capitán capitan ' +
    'maestro maestra amo ama profesor profesora',
);
const ES_ROLE_ONLY = words('mami papi nana yaya yayo el la mi viejo vieja');
const ES_CALENDAR = words(
  'lunes martes miércoles miercoles jueves viernes sábado sabado domingo enero febrero marzo abril mayo junio julio ' +
    'agosto septiembre setiembre octubre noviembre diciembre',
);
const ES_NUMBER_WORDS =
  'cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|' +
  'diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidós|veintidos|veintitrés|veintitres|treinta|cuarenta|cincuenta|' +
  'sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|mil';
const ES_KIN_WORDS = words('tío tía tio tia primo prima abuelo abuela abuelito abuelita yayo yaya');
const ES_FAMILY =
  `padres?|madres?|hij[oa]s?|herman[oa]s?|hermanastr[oa]s?|t[ií][oa]s?|sobrin[oa]s?|prim[oa]s?|espos[oa]s?|maridos?|mujer|` +
  `casad[oa]s?|casar${WORD_CHAR}*|cas[oó]|bodas?|matrimonios?|viud[oa]s?|prometid[oa]s?|novi[oa]s?|compromiso|` +
  `abuel${WORD_CHAR}*|bisabuel${WORD_CHAR}*|niet[oa]s?|biznie${WORD_CHAR}*|suegr[oa]s?|cuñad[oa]s?|cunad[oa]s?|yernos?|nueras?|` +
  `padrastros?|madrastras?|hijastr[oa]s?|pap[aá]|mam[aá]|familias?|familiar(?:es)?|parientes?|parentesco|emparentad[oa]s?|` +
  `herederos?|herederas?|primog[eé]nit[oa]s?|mayor|menor|gemel[oa]s?|melliz[oa]s?|hu[eé]rfan[oa]s?|linaje|sangre`;
const ES_KIN = '(?:t[ií][oa]s?|prim[oa]s?|abuel[oa]s?|abuelit[oa]s?|yay[oa]s?)';
const ES_POSSESSIVE_KIN = `${WORD_EDGE}(?:su|sus|mi|mis|tu|tus|nuestr[oa]s?|vuestr[oa]s?)\\s+${ES_KIN}${WORD_EDGE}|${WORD_EDGE}${ES_KIN}\\s+del?${WORD_EDGE}`;
const ES_FIRST_PERSON_WORDS = ['yo', 'me', 'mi', 'mí', 'mis', 'conmigo', 'mío', 'mía', 'míos', 'mías'];

function union(english: ReadonlySet<string>, more: readonly string[]): ReadonlySet<string> {
  return new Set([...english, ...more]);
}

const ES_TITLE_SET = union(TITLES, ES_TITLES);
const ES_HONORIFIC_SET = union(HONORIFICS, ES_HONORIFICS);
const ES_FAMILY_SET = union(FAMILY_AND_ROLE_WORDS, ES_FAMILY_AND_ROLE_WORDS);

export const SPANISH_STORY_LEXICON: StoryLexicon = {
  language: 'es',
  writeIn: 'Spanish',
  titles: ES_TITLE_SET,
  namePrefixWords: union(NAME_PREFIX_WORDS, ES_NAME_PREFIX_WORDS),
  honorificOnly: union(HONORIFIC_ONLY, ES_HONORIFIC_ONLY),
  honorifics: ES_HONORIFIC_SET,
  familyAndRoleWords: ES_FAMILY_SET,
  roleOnly: union(EN_ROLE_ONLY, [...ES_FAMILY_AND_ROLE_WORDS, ...ES_ROLE_ONLY]),
  calendar: union(EN_CALENDAR, ES_CALENDAR),
  connectives: new Set(['the', 'and', 'el', 'la', 'los', 'las', 'y', 'e']),
  numberOnly: new RegExp(`^(?:\\d+|(?:${ES_NUMBER_WORDS})(?:(?:[- ]| y )(?:${ES_NUMBER_WORDS}))*)$`, 'iu'),
  houseWords: ['house', 'casa'],
  run: capitalRun(`${EN_HONORIFIC_PREFIX}|Sr|Sra|Srta|Dra|Dña|D|Sto|Sta`, '\\p{Lu}'),
  // Spanish opens questions and exclamations with ¿ and ¡, and dialogue with a dash.
  sentenceStart: /(?:^|[.!?…]["”’»]?\s+|["“«\u2014\u2013\u2015]\s*)[¿¡]?\n?$/u,
  lowerWord: new RegExp(`(?<!${WORD_CHAR})\\p{Ll}[\\p{L}\\p{N}_’'-]*`, 'gu'),
  // "Ud." and "Sr." are capitalised mid-sentence without naming anyone.
  pronounRuns: new Set(['Ud', 'Uds', 'Vd', 'Vds', 'Usted', 'Ustedes', 'Sr', 'Sra', 'Srta', 'Dr', 'Dra', 'D', 'Dña']),
  // A line that opens with a dash is dialogue, the speaker's tag included.
  dialogue: /“[^”]*”|"[^"\n]*"|«[^»]*»|^[ \t]*[\u2014\u2013\u2015].*$/gmu,
  firstPerson: new RegExp(`${WORD_EDGE}(?:yo|me|mi|mí|mis|conmigo|mío|mía|míos|mías)${WORD_EDGE}`, 'giu'),
  thirdPerson: new RegExp(`${WORD_EDGE}(?:él|ella|su|sus|suyo|suya|suyos|suyas|consigo|le|les)${WORD_EDGE}`, 'giu'),
  narrator: new RegExp(`${WORD_EDGE}(?:the narrator|el narrador|la narradora)${WORD_EDGE}`, 'iu'),
  hedge: new RegExp(`${WORD_EDGE}(?:or|o|u)${WORD_EDGE}`, 'iu'),
  placeholder:
    /^(?:none|unknown|n\/?a|no (?:identity )?line|not (?:stated|known)|ningun[oa]?|ningún|desconocid[oa]|sin (?:datos|l[ií]nea)|no (?:consta|se sabe))$/iu,
  kinTitle: new RegExp(`${WORD_EDGE}(?:${[...EN_KIN_WORDS, ...ES_KIN_WORDS].map(anyCase).join('|')})\\s+\\p{Lu}`, 'u'),
  familyWords: new RegExp(`${WORD_EDGE}(?:${EN_FAMILY}|${ES_FAMILY})${WORD_EDGE}`, 'iu'),
  possessiveKin: new RegExp(`${EN_POSSESSIVE_KIN}|${ES_POSSESSIVE_KIN}`, 'iu'),
  elderTitle: {
    aunt_or_uncle_of: new RegExp(`^(?:${EN_AUNT_OR_UNCLE}|t[ií][oa])${WORD_EDGE}`, 'iu'),
    grandparent_of: new RegExp(`^(?:${EN_GRANDPARENT}|abuel[oa]|abuelit[oa]|yay[oa])${WORD_EDGE}`, 'iu'),
  },
  tieStop: new Set([
    ...ES_HONORIFIC_SET,
    ...ES_FAMILY_SET,
    'the',
    'of',
    'and',
    'mr',
    'mrs',
    'ms',
    'miss',
    'el',
    'la',
    'los',
    'las',
    'de',
    'del',
    'y',
  ]),
  firstPersonWords: ES_FIRST_PERSON_WORDS,
  nameToken: /\p{L}[\p{L}\p{N}_']*/gu,
  quoteEdgeChars: `${EN_QUOTE_EDGE_CHARS}¿¡«»`,
  // Grave, acute, circumflex and diaeresis go; the tilde stays, since "ñ" is its own letter.
  nameFold: (word) =>
    word
      .normalize('NFD')
      .replace(/[\u0300-\u0302\u0308]/gu, '')
      .normalize('NFC'),
};

const LEXICONS: Readonly<Record<string, StoryLexicon>> = { en: ENGLISH_STORY_LEXICON, es: SPANISH_STORY_LEXICON };

/** The lexicon for a book's language; English for one without its own. */
export function storyLexicon(language: string | null | undefined): StoryLexicon {
  return (language && LEXICONS[language]) || ENGLISH_STORY_LEXICON;
}

/** A system prompt with the language to write in, before its answer shape; unchanged for English. */
export function writingIn(system: string, lexicon: StoryLexicon, what: string): string {
  if (!lexicon.writeIn) return system;
  const at = system.lastIndexOf('Answer with JSON only');
  const rule = `Write ${what} in ${lexicon.writeIn}.\n`;
  return at < 0 ? `${system}\n${rule}` : system.slice(0, at) + rule + system.slice(at);
}
