import { LINES_SYSTEM, isPlaceholder, laterNames, lineProblem, linesRequest, namedLater, type LineNames } from './lines-step';
import { mergeNames } from './merge-step';
import { isNumberOnly, namesConflict, ownWords } from './name-text';
import {
  NAMES_SYSTEM,
  bookFilter,
  checkNames,
  dropRoleNames,
  nameCandidates,
  namesRequest,
  toldInFirstPerson,
  validateEntries,
  type RawNameEntry,
} from './names-step';
import { PROFILES_SYSTEM, profilesRequest, profilesRewriteRequest } from './profiles-step';
import { applyReview, reviewGroups } from './review-step';
import { syntheticNames, syntheticText } from './step-context.testing';
import { SUMMARIES_SYSTEM, summariesRequest, summariesRewriteRequest } from './summaries-step';
import { ENGLISH_STORY_LEXICON, HUNGARIAN_STORY_LEXICON, SPANISH_STORY_LEXICON, storyLexicon, writingIn, type StoryLexicon } from './story-lexicon';
import { checkTies, findQuote, nameTokens, tiesCast } from './ties-step';

const es = SPANISH_STORY_LEXICON;
const hu = HUNGARIAN_STORY_LEXICON;

function entry(name: string, aliases: string[] = [], kind = 'character'): RawNameEntry {
  return { name, aliases, kind, what: '' };
}

describe('story lexicon', () => {
  it('picks the lexicon by language, English for any other', () => {
    expect(storyLexicon('es')).toBe(SPANISH_STORY_LEXICON);
    expect(storyLexicon('hu')).toBe(HUNGARIAN_STORY_LEXICON);
    expect(storyLexicon('en')).toBe(ENGLISH_STORY_LEXICON);
    expect(storyLexicon('pt')).toBe(ENGLISH_STORY_LEXICON);
    expect(storyLexicon(null)).toBe(ENGLISH_STORY_LEXICON);
  });

  it('asks for Spanish before the answer shape and leaves English prompts alone', () => {
    expect(writingIn(LINES_SYSTEM, ENGLISH_STORY_LEXICON, 'every identity line')).toBe(LINES_SYSTEM);
    expect(linesRequest([]).system).toBe(LINES_SYSTEM);
    const spanish = linesRequest([], es).system;
    expect(spanish).toContain('Use the names exactly as given.\nWrite every identity line in Spanish.\nAnswer with JSON only');
  });

  describe('Spanish names checklist', () => {
    it('lists accented names, names after a title, and nothing a question or dialogue opens', () => {
      const text =
        '\u2014¿Dónde está Óscar? \u2014preguntó el Sr. Golfín.\n\n' +
        'Ángela miró a Óscar y a Teodoro Golfín. ¡Vamos! dijo ella.\n\n' +
        'Ud. no conoce a Nela, contestó Ángela.';
      const listed = nameCandidates(text, es);
      expect(listed).toEqual(expect.arrayContaining(['Óscar', 'Sr. Golfín', 'Teodoro Golfín', 'Nela', 'Ángela']));
      expect(listed).not.toContain('Dónde');
      expect(listed).not.toContain('Vamos');
      expect(listed).not.toContain('Ud');
    });

    it('reads English accents out of the checklist as before', () => {
      expect(nameCandidates('They met Óscar in town. Óscar smiled.')).not.toContain('Óscar');
    });
  });

  describe('Spanish narration', () => {
    const firstPerson =
      'Yo no sabía qué hacer. Mi padre me miró desde la puerta y yo bajé los ojos.\n' +
      '\u2014No te vayas \u2014me dijo él\u2014. Mañana será otro día.\n' +
      'Aquella noche no dormí. Pensé en mi madre y en mis hermanos, que me esperaban lejos.';
    const thirdPerson =
      'Ella no sabía qué hacer. Su padre la miró desde la puerta y ella bajó los ojos.\n' +
      '\u2014Yo no me voy, mi padre \u2014le dijo ella\u2014. Mañana será otro día, y mi vida es mía.\n' +
      'Aquella noche no durmió. Pensó en su madre y en sus hermanos, que le esperaban lejos.';

    it('tells first-person narration from dialogue in the first person', () => {
      expect(toldInFirstPerson(firstPerson, es)).toBe(true);
      expect(toldInFirstPerson(thirdPerson, es)).toBe(false);
    });
  });

  describe('Spanish names', () => {
    it('drops titles, articles and particles from a name own words', () => {
      expect(ownWords('Doña Perfecta', es)).toEqual(['perfecta']);
      expect(ownWords('Pablo de Penáguilas', es)).toEqual(['pablo', 'penaguilas']);
      expect(ownWords('el señor Golfín', es)).toEqual(['golfin']);
      expect(ownWords('Doña Perfecta')).toEqual(['doña', 'perfecta']);
    });

    it('drops role words, days and articles as entries', () => {
      const book = { title: 'Marianela', authors: ['Benito Pérez Galdós'] };
      expect(dropRoleNames([entry('Mamá'), entry('Abuela', ['Doña Ana'])], es).map((item) => item.name)).toEqual(['Doña Ana']);
      expect(
        bookFilter([entry('Lunes', [], 'event'), entry('La', [], 'place'), entry('Socartes', [], 'place')], book, es).map((item) => item.name),
      ).toEqual(['Socartes']);
      expect(isNumberOnly('Veintidós', es.numberOnly)).toBe(true);
      expect(isNumberOnly('Teodoro', es.numberOnly)).toBe(false);
    });

    it('compares names without their accents, keeping the ñ', () => {
      expect(ownWords('D. Cárlos Golfin', es)).toEqual(['carlos', 'golfin']);
      expect(ownWords('Lúcas', es)).toEqual(ownWords('Lucas', es));
      expect(ownWords('Peña', es)).toEqual(['peña']);
      expect(ownWords('Zoë Hart')).toEqual(['zoë', 'hart']);
    });

    it('lets the review join one person spelled with and without accents', () => {
      const text = syntheticText([['Cárlos Golfin dirigía las minas.'], ['Carlos Golfín volvió a casa.']]);
      const names = syntheticNames(text, { c1p1: [['Cárlos Golfin']], c2p1: [['Carlos Golfín']] });
      const merge = mergeNames(text.passages, names, es);
      const groups = reviewGroups([{ ids: merge.entities.map((entity) => entity.id) }], merge, text);
      const spanish = applyReview(groups, merge, text, es);
      expect(spanish.blocked).toEqual([]);
      expect(spanish.cast).toHaveLength(1);
      expect(applyReview(groups, merge, text).blocked.map((item) => item.reason)).toEqual(['another-person']);
    });

    it('keeps a title and surname alias only for the person with that surname', () => {
      const text = 'Teodoro Golfín llegó. El Sr. Golfín y el Sr. Centeno hablaron.';
      const [kept] = validateEntries([entry('Teodoro Golfín', ['Sr. Golfín', 'Sr. Centeno'])], text, es);
      expect(kept.aliases).toEqual(['Sr. Golfín']);
    });
  });

  describe('Spanish lines', () => {
    const names: LineNames = { later: [], visible: [], lexicon: es };

    it('refuses a hedge and "the narrator" in Spanish', () => {
      expect(lineProblem('Hermana o prima de Pablo', names)?.reason).toBe('hedged');
      expect(lineProblem('Amiga de la narradora', names)?.reason).toBe('narrator');
      expect(lineProblem('Hermana de Pablo, vive en Socartes', names)).toBeNull();
    });

    it('treats Spanish placeholders as no line', () => {
      expect(isPlaceholder('Ninguna', es)).toBe(true);
      expect(isPlaceholder('Desconocido.', es)).toBe(true);
      expect(isPlaceholder('Ninguna')).toBe(false);
    });
  });

  describe('Spanish ties', () => {
    it('reads accented names and leaves out titles and family words', () => {
      expect([...nameTokens(['Ángela', 'Doña Perfecta', 'tía Remedios'], es)]).toEqual(['ángela', 'perfecta', 'remedios']);
      expect([...nameTokens(['Ángela'])]).toEqual(['ngela']);
    });

    it('finds a quote whatever Spanish punctuation edges it', () => {
      const text = '\u2014¿Dónde está mi hermana? \u2014preguntó Pablo.';
      expect(findQuote('¿Dónde está mi hermana?', text, es)).not.toBeNull();
      expect(findQuote('«Dónde está mi hermana»', text, es)).not.toBeNull();
    });

    it('treats a possessive before a Spanish kin word as kinship', () => {
      expect(es.kinTitle.test('la tía Remedios llegó')).toBe(true);
      expect(es.possessiveKin.test('su tía Remedios')).toBe(true);
      expect(es.possessiveKin.test('la tía de Pablo')).toBe(true);
      expect(es.familyWords.test('es hermana de Pablo')).toBe(true);
      expect(es.elderTitle.aunt_or_uncle_of!.test('Tía Remedios')).toBe(true);
      expect(es.elderTitle.grandparent_of!.test('Abuela Ana')).toBe(true);
    });
  });

  it('asks for profiles and summaries in the book language, and leaves English prompts alone', () => {
    expect(profilesRequest('', []).system).toBe(PROFILES_SYSTEM);
    expect(summariesRequest('', null).system).toBe(SUMMARIES_SYSTEM);
    for (const [lexicon, language] of [
      [es, 'Spanish'],
      [hu, 'Hungarian'],
    ] as const) {
      expect(profilesRequest('', [], lexicon).system).toContain(`Write every profile in ${language}.\nAnswer with JSON only`);
      expect(profilesRewriteRequest([], lexicon).system).toContain(`Write every profile in ${language}.\nAnswer with JSON only`);
      expect(summariesRequest('', null, lexicon).system).toContain(`Write the summary in ${language}.\nAnswer with JSON only`);
      expect(summariesRewriteRequest('', '', lexicon).system).toContain(`Write the summary in ${language}.\nAnswer with JSON only`);
    }
  });

  describe('Hungarian prompts', () => {
    const book = { title: 'A Pál utcai fiúk', authors: ['Molnár Ferenc'] };

    it('asks for Hungarian lines and for names without their case endings', () => {
      expect(linesRequest([], hu).system).toContain('Write every identity line in Hungarian.\nAnswer with JSON only');
      expect(namesRequest(book, 'Boka a grundon állt.', hu).system).toContain('Write every name without its case ending');
      expect(namesRequest(book, 'Boka a grundon állt.').system).toBe(NAMES_SYSTEM);
    });
  });

  describe('Hungarian names checklist', () => {
    it('lists names after a dash or a low quote only mid-sentence, and never the polite Ön', () => {
      const text =
        '\u2013 Hol van Nemecsek? \u2013 kérdezte Boka János.\n\n' +
        'Geréb ránézett Nemecsekre. „Gyertek!” \u2013 kiáltotta Csónakos.\n\n' +
        'Ön nem ismeri Áts Ferit, felelte Geréb.';
      const listed = nameCandidates(text, hu);
      expect(listed).toEqual(expect.arrayContaining(['Nemecsek', 'Boka János', 'Csónakos', 'Áts Ferit', 'Geréb']));
      expect(listed).not.toContain('Hol');
      expect(listed).not.toContain('Gyertek');
      expect(listed).not.toContain('Ön');
    });
  });

  describe('Hungarian narration', () => {
    const firstPerson =
      'Nem tudtam, mit tegyek. Apám az ajtóból nézett rám, én pedig lesütöttem a szemem.\n' +
      '\u2013 Ne menj el \u2013 mondta nekem ő.\n' +
      'Aznap éjjel nem aludtam. Anyámra gondoltam, és a testvéreimre, akik messze vártak rám. Velem senki sem beszélt.';
    const thirdPerson =
      'Ő nem tudta, mit tegyen. Az apja az ajtóból nézett rá, ő pedig lesütötte a szemét.\n' +
      '\u2013 Én nem megyek el, nekem itt a helyem, velem maradsz \u2013 mondta neki.\n' +
      'Aznap éjjel nem aludt. Az anyjára gondolt, és a testvéreire, akik messze várták őt.';

    it('tells first-person narration from dialogue in the first person', () => {
      expect(toldInFirstPerson(firstPerson, hu)).toBe(true);
      expect(toldInFirstPerson(thirdPerson, hu)).toBe(false);
    });
  });

  describe('Hungarian names', () => {
    it('drops titles that follow the name, and reads "ö" for an old "ő"', () => {
      expect(ownWords('Rácz tanár úr', hu)).toEqual(['rácz']);
      expect(ownWords('Nemes főfelügyelő', hu)).toEqual(['nemes']);
      expect(ownWords('Mari néni', hu)).toEqual(['mari']);
      expect(ownWords('dr. Kovács', hu)).toEqual(['kovács']);
      expect(ownWords('Ernő', hu)).toEqual(ownWords('Ernö', hu));
      expect(ownWords('Ernõ', hu)).toEqual(ownWords('Ernő', hu));
      expect(ownWords('Mari néni')).toEqual(['mari', 'néni']);
    });

    it('drops role words, days, articles and numbers as entries', () => {
      const book = { title: 'A Pál utcai fiúk', authors: ['Molnár Ferenc'] };
      expect(dropRoleNames([entry('Nagyapa'), entry('Anyu', ['Kovácsné'])], hu).map((item) => item.name)).toEqual(['Kovácsné']);
      expect(
        bookFilter([entry('Hétfő', [], 'event'), entry('Az', [], 'place'), entry('Pest', [], 'place')], book, hu).map((item) => item.name),
      ).toEqual(['Pest']);
      expect(isNumberOnly('Huszonhárom', hu.numberOnly)).toBe(true);
      expect(isNumberOnly('Nemecsek', hu.numberOnly)).toBe(false);
    });

    it('keeps a name the passage prints only with an ending that lengthens it, and shows it as written', () => {
      const text = syntheticText([['Bokát mindenki szerette. Bokának volt a legtöbb barátja a grundon.']]);
      const answer = { narrator: null, entries: [entry('Boka')] };
      const book = { title: 'A Pál utcai fiúk', authors: ['Molnár Ferenc'] };
      expect(checkNames(answer, text.passages[0], book).entries).toEqual([]);
      const result = checkNames(answer, text.passages[0], book, hu);
      expect(result.entries.map((item) => item.at.Boka)).toEqual([{ passage: 'c1p1', offset: 0, text: 'Boká' }]);
      const merge = mergeNames(text.passages, new Map([['c1p1', result]]), hu);
      expect(merge.entities[0].names.map((name) => name.text)).toEqual(['Boka']);
    });
  });

  describe('Hungarian name order', () => {
    const words = (name: string) => ownWords(name, hu);
    const review = (chapters: string[], names: Record<string, [string][]>, lexicon: StoryLexicon, grouped?: string[] | string[][]) => {
      const text = syntheticText(chapters.map((chapter) => [chapter]));
      const merge = mergeNames(text.passages, syntheticNames(text, names), lexicon);
      const lists = !grouped
        ? [merge.entities.map((entity) => entity.name)]
        : typeof grouped[0] === 'string'
          ? [grouped as string[]]
          : (grouped as string[][]);
      const ids = (list: string[]) => merge.entities.filter((entity) => list.includes(entity.name)).map((entity) => entity.id);
      const groups = reviewGroups(
        lists.map((list) => ({ ids: ids(list) })),
        merge,
        text,
      );
      return applyReview(groups, merge, text, lexicon).blocked.map((item) => [merge.entities[item.id].name, item.reason]);
    };

    it('tells people apart by the words they do not share, whichever order the book writes them in', () => {
      expect(namesConflict(words('Boka János'), words('Boka Ferenc'), true)).toBe(true);
      expect(namesConflict(words('Sherlock Holmes'), words('Mycroft Holmes'), true)).toBe(true);
      expect(namesConflict(words('Nemecsek Ernő'), words('Ernő Nemecsek'), true)).toBe(false);
      expect(namesConflict(words('Boka János'), words('Boka'), true)).toBe(false);
      expect(namesConflict(words('Pat Smith'), words('Patrick Smith'), true)).toBe(false);
      expect(namesConflict(words('Boka János'), words('Boka Ferenc'))).toBe(false);
    });

    it('leaves names that share a word to the review: a nickname, a married surname or two relatives', () => {
      const chapters = ['Kőrössy Béla úszott.', 'Kőrössy Tyutyu nevetett.', 'Harmat Márta főzött.', 'Erőss Márta telefonált.'];
      const names = { c1p1: [['Kőrössy Béla']], c2p1: [['Kőrössy Tyutyu']], c3p1: [['Harmat Márta']], c4p1: [['Erőss Márta']] } as Record<
        string,
        [string][]
      >;
      const groups = [
        ['Kőrössy Béla', 'Kőrössy Tyutyu'],
        ['Harmat Márta', 'Erőss Márta'],
      ];
      expect(review(chapters, names, hu, groups)).toEqual([]);
      const bokas = { c1p1: [['Boka János']], c2p1: [['Boka Ferenc']] } as Record<string, [string][]>;
      expect(review(['Boka János a grundon állt.', 'Boka Ferenc hazament.'], bokas, hu)).toEqual([]);
    });

    it('keeps a surname two people share out of joins, at either end of their names', () => {
      const chapters = ['Boka János a grundon állt.', 'Boka Ferenc hazament.', 'Boka nevetett.'];
      const names = { c1p1: [['Boka János']], c2p1: [['Boka Ferenc']], c3p1: [['Boka']] } as Record<string, [string][]>;
      expect(review(chapters, names, hu, ['Boka János', 'Boka'])).toEqual([['Boka', 'shared-surname']]);
      expect(review(chapters, names, ENGLISH_STORY_LEXICON, ['Boka János', 'Boka'])).toEqual([]);
      const holmes = { c1p1: [['Sherlock Holmes']], c2p1: [['Mycroft Holmes']], c3p1: [['Holmes']] } as Record<string, [string][]>;
      expect(review(['Sherlock Holmes ült.', 'Mycroft Holmes jött.', 'Holmes nevetett.'], holmes, hu, ['Sherlock Holmes', 'Holmes'])).toEqual([
        ['Holmes', 'shared-surname'],
      ]);
    });

    it('reads each name in its own order in a book that mixes them', () => {
      const chapters = ['Nemes Albert belépett.', 'Thomas Beresford várt.', 'Albert leült. Nemes fáradt volt.', 'Beresford nevetett.'];
      const names = {
        c1p1: [['Nemes Albert']],
        c2p1: [['Thomas Beresford']],
        c3p1: [['Albert'], ['Nemes']],
        c4p1: [['Beresford']],
      } as Record<string, [string][]>;
      expect(namesConflict(words('Nemes Albert'), words('Thomas Beresford'), true)).toBe(true);
      expect(
        review(chapters, names, hu, [
          ['Nemes Albert', 'Albert', 'Nemes'],
          ['Thomas Beresford', 'Beresford'],
        ]),
      ).toEqual([]);
      expect(review(chapters, names, hu, ['Nemes Albert', 'Thomas Beresford', 'Albert', 'Beresford'])).toContainEqual([
        'Thomas Beresford',
        'another-person',
      ]);
    });

    it('keeps a title after the surname only for the person with that surname', () => {
      const text = 'Kovács Péter belépett. Kovács úr és Szabó úr beszélgettek.';
      const [kept] = validateEntries([entry('Kovács Péter', ['Kovács úr', 'Szabó úr'])], text, hu);
      expect(kept.aliases).toEqual(['Kovács úr']);
    });
  });

  describe('Hungarian lines', () => {
    const names: LineNames = { later: [], visible: [], lexicon: hu };

    it('refuses a hedge and "the narrator" in Hungarian', () => {
      expect(lineProblem('Boka barátja vagy testvére', names)?.reason).toBe('hedged');
      expect(lineProblem('Az elbeszélő barátja', names)?.reason).toBe('narrator');
      expect(lineProblem('Boka barátja, a grundon játszik', names)).toBeNull();
    });

    it('treats Hungarian placeholders as no line', () => {
      expect(isPlaceholder('Nincs adat', hu)).toBe(true);
      expect(isPlaceholder('Ismeretlen.', hu)).toBe(true);
      expect(isPlaceholder('Ismeretlen')).toBe(false);
    });

    it('catches a later name with a case ending', () => {
      const text = syntheticText([['Nemecsek a grundra ment.'], ['Boka várta a grundon.']]);
      const merge = mergeNames(text.passages, syntheticNames(text, { c1p1: [['Nemecsek']], c2p1: [['Boka']] }), hu);
      expect(namedLater('Nemecsek Bokának segít', laterNames(0, text, merge, hu))).toEqual(['Boka']);
      expect(namedLater('Nemecsek Bokának segít', laterNames(0, text, merge))).toEqual([]);
    });

    it('folds a name the model gave with its case ending into the bare name, wherever the bare name comes first', () => {
      const text = syntheticText([
        ['Azt a rohadék Kunt elő kell keríteni. Vettem egy Sport/Embert.'],
        ['Kun megszökött. A Sport/Ember címlapján volt. Moldován és Moldova.'],
      ]);
      const names = syntheticNames(text, {
        c1p1: [['Kunt'], ['Sport/Embert', [], 'object']],
        c2p1: [['Kun'], ['Sport/Ember', [], 'group'], ['Moldován'], ['Moldova', [], 'place']],
      });
      const merged = (lexicon: StoryLexicon) => mergeNames(text.passages, names, lexicon).entities.map((entity) => entity.name);
      expect(merged(hu)).toEqual(['Kun', 'Sport/Ember', 'Moldován', 'Moldova']);
      expect(merged(ENGLISH_STORY_LEXICON)).toEqual(['Kunt', 'Sport/Embert', 'Kun', 'Sport/Ember', 'Moldován', 'Moldova']);
      expect(mergeNames(text.passages, names, hu).entities[0].names.map((name) => name.text)).toEqual(['Kun']);
    });

    it('reads the bare forms an inflected name could stand for, without plurals or a bare -n', () => {
      expect(hu.caseStems('Bokát')).toEqual(['Boká', 'Boka']);
      expect(hu.caseStems('Keletről')).toEqual(['Kelet']);
      expect(hu.caseStems('Kunnal')).toEqual(['Kun']);
      expect(hu.caseStems('Radomirék')).toEqual([]);
      expect(hu.caseStems('Moldován')).toEqual([]);
      expect(ENGLISH_STORY_LEXICON.caseStems('Bokát')).toEqual([]);
    });
  });

  describe('Hungarian ties', () => {
    it('finds both sides of a tie when the quote names them only with case endings', () => {
      const text = 'Bokát és Nemecseket mindenki ismerte a grundon.';
      const book = syntheticText([[text]]);
      const found = checkNames(
        { narrator: null, entries: [entry('Nemecsek'), entry('Boka')] },
        book.passages[0],
        { title: 'A Pál utcai fiúk', authors: [] },
        hu,
      );
      const names = new Map([['c1p1', found]]);
      const merge = mergeNames(book.passages, names, hu);
      const relation = { a: 'Nemecsek', type: 'friend_of', b: 'Boka', quote: 'Bokát és Nemecseket mindenki ismerte' };
      const check = (lexicon: StoryLexicon) =>
        checkTies([relation], book.passages[0], tiesCast(names.get('c1p1')!, text, undefined, lexicon), merge.placement.c1p1);
      expect(check(hu).kept.map((item) => item.evidence)).toEqual(['quote']);
      expect(check(ENGLISH_STORY_LEXICON).dropped.map((item) => item.reason)).toEqual(['a side is not named near the quote']);
    });

    it('finds a quote edged by Hungarian quote marks', () => {
      const text = '»Hol van a húgom?« \u2013 kérdezte Boka.';
      expect(findQuote('„Hol van a húgom?”', text, hu)).not.toBeNull();
    });

    it('reads a kin word after the name as a title and one with a possessive ending as kinship', () => {
      expect(hu.kinTitle.test('Mari néni megérkezett')).toBe(true);
      expect(hu.possessiveKin.test('Pali nagynénje')).toBe(true);
      expect(hu.possessiveKin.test('a nagyapám')).toBe(true);
      expect(hu.possessiveKin.test('nagyapa')).toBe(false);
      expect(hu.familyWords.test('Boka apja volt')).toBe(true);
      expect(hu.familyWords.test('a grundon játszottak')).toBe(false);
      expect(hu.elderTitle.aunt_or_uncle_of!.test('Mari néni')).toBe(true);
      expect(hu.elderTitle.aunt_or_uncle_of!.test('Nemecsek')).toBe(false);
      expect(hu.elderTitle.grandparent_of!.test('Nagyapa')).toBe(true);
    });
  });
});
