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
  /**
   * A name word as names are compared: Spanish spells one name with and without its accents ("Cárlos", "Carlos"),
   * older Hungarian typesetting prints "Ernő" as "Ernö".
   */
  nameFold: (word: string) => string;
  /**
   * For a language whose names take case endings in the text: a regex source for an already escaped
   * name with the endings it can carry ("Boka", "Bokát"). Null where names stand as they are.
   */
  nameInflection: ((escapedName: string) => string) | null;
  /**
   * The bare forms an inflected name could stand for, for a language whose names take case endings
   * ("Bokát" could be "Boka", "Kunt" could be "Kun"). Empty where names stand as they are.
   */
  caseStems: (name: string) => string[];
  /** A rule the names prompt adds for the language; null for none. */
  namesRule: string | null;
  /**
   * Whether a book's names come in either order: Hungarian writes its own family name first ("Boka
   * János") and keeps the original order for translated ones ("Sherlock Holmes").
   */
  eitherNameOrder: boolean;
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
  nameInflection: null,
  caseStems: () => [],
  namesRule: null,
  eitherNameOrder: false,
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
  nameInflection: null,
  caseStems: () => [],
  namesRule: null,
  eitherNameOrder: false,
};

// Hungarian. Titles and kin words follow the name ("Kovács úr", "Mari néni"), names take case
// endings ("Nemecseknek", "Bokát"), and pronouns do not tell he from she.
const HU_TITLES = words(
  'úr ur asszony kisasszony néni bácsi özvegy özv dr id ifj idősebb ifjabb gróf grófnő báró bárónő herceg hercegnő ' +
    'király királyné királynő királyfi királylány kapitány tábornok ezredes őrnagy hadnagy főhadnagy százados ' +
    'nagynéni nagybácsi nagyapa nagyanya nagymama nagypapa tanár tanító doktor mester a az',
);
const HU_NAME_PREFIX_WORDS = words(
  'felügyelő főfelügyelő nyomozó rendőr főkapitány őrmester törzsőrmester főtörzsőrmester tizedes alezredes vezérőrnagy bíró polgármester elnök miniszter szenátor professzor tanárnő tanítónő ' +
    'orvos ápoló ápolónő tiszteletes plébános pap atya páter püspök érsek bíboros szent szt császár császárné főnök ' +
    'ügyvéd jegyző',
);
const HU_HONORIFIC_ONLY = words(
  'felség felséges őfelsége fenség fenséges őfensége méltóság méltóságos kegyelmes nagyságos tekintetes excellenciás ' +
    'eminenciás uram asszonyom ön önök maga őrség őr őrök',
);
const HU_HONORIFICS = words('dr özv id ifj úr asszony kisasszony néni bácsi doktor tanár');
const HU_FAMILY_AND_ROLE_WORDS = words(
  'apa anya apu anyu apuka anyuka papa mama édesapa édesanya nagyapa nagyanya nagymama nagypapa nagyi nagynéni nagybácsi ' +
    'néni bácsi úr asszony kisasszony király királyné királynő herceg hercegnő tábornok ezredes doktor kapitány tanár mester',
);
const HU_ROLE_ONLY = words('apám anyám apukám anyukám édesapám édesanyám uram asszonyom fiam lányom öreg öregem a az');
const HU_CALENDAR = words(
  'hétfő kedd szerda csütörtök péntek szombat vasárnap január február március április május június július augusztus ' +
    'szeptember október november december',
);
// Written as one word: "huszonhárom", "kétszáz".
const HU_NUMBER_PARTS =
  'nulla|egy|kettő|két|három|négy|öt|hat|hét|nyolc|kilenc|tíz|tizen|húsz|huszon|harminc|negyven|ötven|hatvan|hetven|' +
  'nyolcvan|kilencven|száz|ezer';
const HU_KIN_TITLES = '(?:néni|bácsi|nagynéni|nagybácsi)';
const HU_FAMILY =
  `ap(?:a|ja|ám|ád|juk|ának|át|ával|u|uka|uká${WORD_CHAR}*)|any(?:a|ja|ám|ád|juk|ának|át|ával|u|uka|uká${WORD_CHAR}*)|` +
  `édesap${WORD_CHAR}*|édesany${WORD_CHAR}*|szül(?:ő|ei|eim|eid|einek|eit|ők|őket|őknek)${WORD_CHAR}*|` +
  `fi(?:a|am|ad|ai|aim|ait|át|ának|ával|uk|unk)|lány(?:a|om|od|ai|aim|át|ának|ával|uk|unk)|gyerek${WORD_CHAR}*|gyermek${WORD_CHAR}*|` +
  `testvér${WORD_CHAR}*|báty${WORD_CHAR}*|öcs${WORD_CHAR}*|öccs${WORD_CHAR}*|húg${WORD_CHAR}*|nővér${WORD_CHAR}*|iker|ikr${WORD_CHAR}*|` +
  `férj${WORD_CHAR}*|feleség${WORD_CHAR}*|házas${WORD_CHAR}*|esküv${WORD_CHAR}*|özvegy${WORD_CHAR}*|jegyes${WORD_CHAR}*|` +
  `menyasszony${WORD_CHAR}*|vőlegény${WORD_CHAR}*|eljegyz${WORD_CHAR}*|nagyap${WORD_CHAR}*|nagyany${WORD_CHAR}*|nagymam${WORD_CHAR}*|` +
  `nagypap${WORD_CHAR}*|nagynén${WORD_CHAR}*|nagybác${WORD_CHAR}*|nagybáty${WORD_CHAR}*|unok${WORD_CHAR}*|déd${WORD_CHAR}*|` +
  `mostoh${WORD_CHAR}*|após${WORD_CHAR}*|anyós${WORD_CHAR}*|sógor${WORD_CHAR}*|sógornő${WORD_CHAR}*|menye|vej${WORD_CHAR}*|` +
  `család${WORD_CHAR}*|rokon${WORD_CHAR}*|örökös${WORD_CHAR}*|elsőszülött${WORD_CHAR}*|árva${WORD_CHAR}*`;
// The kin words with a possessive ending: "nagynénje" (her aunt), "nagyapám" (my grandfather).
const HU_POSSESSIVE_KIN = `${WORD_EDGE}(?:nagyné(?:né|nj)|nagybáty[jáo]|nagyany[jáo]|nagyap[jáo]|nagymamá|nagypapá|unokatestvér[eéü]|nénj|bátyj)${WORD_CHAR}*`;
const HU_FIRST_PERSON =
  'én|engem|nekem|velem|tőlem|rólam|rám|hozzám|nálam|bennem|belém|belőlem|rajtam|mellettem|előttem|mögöttem|' +
  'utánam|körülöttem|enyém|magam|magamat|magamnak|magamban|magammal';
const HU_THIRD_PERSON =
  'ő|őt|ők|őket|neki|nekik|vele|velük|tőle|tőlük|róla|róluk|rá|rájuk|hozzá|hozzájuk|nála|náluk|benne|bennük|' +
  'belőle|rajta|rajtuk|mellette|előtte|mögötte|övé|övék';
const HU_CASE_ENDING = '-?\\p{Ll}{1,8}';
// Case endings only, not plurals ("Radomirék" is the family) or derived words ("Keleti"), and not a
// bare "-n", which surnames end with ("Moldován" is not "Moldova").
const HU_CASE_SUFFIXES =
  'nak nek ban ben ba be ból ből ra re ról ről on en ön hoz hez höz tól től nál nél val vel ig ért ként vá vé at et ot öt t'.split(' ');

function hungarianCaseStems(name: string): string[] {
  const stems = new Set<string>();
  for (const suffix of HU_CASE_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    const stem = name.slice(0, -suffix.length).replace(/-$/u, '');
    if (stem.length < 3) continue;
    stems.add(stem);
    // A final a or e lengthens before an ending: "Bokát" is "Boka".
    if (/[áé]$/u.test(stem)) stems.add(`${stem.slice(0, -1)}${stem.endsWith('á') ? 'a' : 'e'}`);
  }
  // "-val" and "-vel" take the sound of a final consonant: "Kunnal" is "Kun".
  if (/(\p{L})\1[ae]l$/u.test(name)) stems.add(name.slice(0, -3));
  return [...stems];
}

const HU_TITLE_SET = union(TITLES, HU_TITLES);
const HU_HONORIFIC_SET = union(HONORIFICS, HU_HONORIFICS);
const HU_FAMILY_SET = union(FAMILY_AND_ROLE_WORDS, HU_FAMILY_AND_ROLE_WORDS);

export const HUNGARIAN_STORY_LEXICON: StoryLexicon = {
  language: 'hu',
  writeIn: 'Hungarian',
  titles: HU_TITLE_SET,
  namePrefixWords: union(NAME_PREFIX_WORDS, HU_NAME_PREFIX_WORDS),
  honorificOnly: union(HONORIFIC_ONLY, HU_HONORIFIC_ONLY),
  honorifics: HU_HONORIFIC_SET,
  familyAndRoleWords: HU_FAMILY_SET,
  roleOnly: union(EN_ROLE_ONLY, [...HU_FAMILY_AND_ROLE_WORDS, ...HU_ROLE_ONLY]),
  calendar: union(EN_CALENDAR, HU_CALENDAR),
  connectives: new Set(['the', 'and', 'a', 'az', 'egy', 'és', 's']),
  numberOnly: new RegExp(`^(?:\\d+|(?:${HU_NUMBER_PARTS})+(?:[- ](?:${HU_NUMBER_PARTS})+)*)$`, 'iu'),
  houseWords: ['house'],
  run: capitalRun(`${EN_HONORIFIC_PREFIX}|Id|Ifj|Özv|Szt`, '\\p{Lu}'),
  // Hungarian quotes open low („) and set inner quotes in guillemets either way round; dialogue opens with a dash.
  sentenceStart: /(?:^|[.!?…]["”’»«]?\s+|["“„«»—–―]\s*)\n?$/u,
  lowerWord: new RegExp(`(?<!${WORD_CHAR})\\p{Ll}[\\p{L}\\p{N}_’'-]*`, 'gu'),
  // The polite "Ön" is capitalised mid-sentence without naming anyone.
  pronounRuns: new Set(['Ön', 'Önök', 'Önt', 'Önnek', 'Önnel', 'Öntől', 'Önről', 'Dr', 'Id', 'Ifj', 'Özv']),
  // A line that opens with a dash is dialogue, the speaker's tag included.
  dialogue: /„[^”"\n]*[”"]|“[^”]*”|"[^"\n]*"|»[^«]*«|«[^»]*»|^[ \t]*[—–―].*$/gmu,
  firstPerson: new RegExp(`${WORD_EDGE}(?:${HU_FIRST_PERSON})${WORD_EDGE}`, 'giu'),
  thirdPerson: new RegExp(`${WORD_EDGE}(?:${HU_THIRD_PERSON})${WORD_EDGE}`, 'giu'),
  narrator: new RegExp(`${WORD_EDGE}(?:the narrator|narrátor${WORD_CHAR}*|elbeszélő${WORD_CHAR}*)${WORD_EDGE}`, 'iu'),
  hedge: new RegExp(`${WORD_EDGE}(?:or|vagy|avagy)${WORD_EDGE}`, 'iu'),
  placeholder:
    /^(?:none|unknown|n\/?a|no (?:identity )?line|not (?:stated|known)|nincs(?: adat| információ| sor)?|ismeretlen|nem ismert|nem tudni|semmi)$/iu,
  kinTitle: new RegExp(`${WORD_EDGE}(?:${EN_KIN_WORDS.map(anyCase).join('|')})\\s+\\p{Lu}|\\p{Lu}${WORD_CHAR}*\\s+${HU_KIN_TITLES}${WORD_EDGE}`, 'u'),
  familyWords: new RegExp(`${WORD_EDGE}(?:${EN_FAMILY}|${HU_FAMILY})${WORD_EDGE}`, 'iu'),
  possessiveKin: new RegExp(`${EN_POSSESSIVE_KIN}|${HU_POSSESSIVE_KIN}`, 'iu'),
  // The kin word may stand alone or after the name: "Nagyapa", "Mari néni".
  elderTitle: {
    aunt_or_uncle_of: new RegExp(`^${EN_AUNT_OR_UNCLE}${WORD_EDGE}|(?:^|\\s)${HU_KIN_TITLES}$`, 'iu'),
    grandparent_of: new RegExp(`^${EN_GRANDPARENT}${WORD_EDGE}|(?:^|\\s)(?:nagyapa|nagyanya|nagymama|nagypapa|nagyi|öregapó|öreganyó)$`, 'iu'),
  },
  tieStop: new Set([...HU_HONORIFIC_SET, ...HU_FAMILY_SET, 'the', 'of', 'and', 'mr', 'mrs', 'ms', 'miss', 'a', 'az', 'egy', 'és']),
  firstPersonWords: words(HU_FIRST_PERSON.replace(/\|/g, ' ')),
  nameToken: /\p{L}[\p{L}\p{N}_']*/gu,
  quoteEdgeChars: `${EN_QUOTE_EDGE_CHARS}„”»«`,
  // Older typesetting and Latin-1 text print "ő" and "ű" as "ö", "õ" or "ô" and "ü", "û" or "ũ": "Ernő" is "Ernö".
  nameFold: (word) => word.normalize('NFC').replace(/[őõô]/gu, 'ö').replace(/[űûũ]/gu, 'ü'),
  // A final a or e lengthens before an ending: "Boka", "Bokát", "Bokának".
  nameInflection: (escaped) => {
    const lengthened = /[ae]$/u.test(escaped) ? `|${escaped.slice(0, -1)}${escaped.endsWith('a') ? 'á' : 'é'}(?:${HU_CASE_ENDING})` : '';
    return `(?:${escaped}(?:${HU_CASE_ENDING})?${lengthened})`;
  },
  caseStems: hungarianCaseStems,
  namesRule:
    'Names in Hungarian take case endings ("Nemecseknek", "Bokát", "Pestre"). Write every name without its case ending, as it stands ' +
    'as the subject of a sentence ("Nemecsek", "Boka", "Pest"), and give each name once, never once per ending. Keep a title that ' +
    'follows the name with it ("Rácz tanár úr", "Mari néni").',
  eitherNameOrder: true,
};

const LEXICONS: Readonly<Record<string, StoryLexicon>> = { en: ENGLISH_STORY_LEXICON, es: SPANISH_STORY_LEXICON, hu: HUNGARIAN_STORY_LEXICON };

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
