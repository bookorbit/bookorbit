import { LINES_SYSTEM, isPlaceholder, lineProblem, linesRequest, type LineNames } from './lines-step';
import { mergeNames } from './merge-step';
import { isNumberOnly, ownWords } from './name-text';
import { bookFilter, dropRoleNames, nameCandidates, toldInFirstPerson, validateEntries, type RawNameEntry } from './names-step';
import { applyReview, reviewGroups } from './review-step';
import { syntheticNames, syntheticText } from './step-context.testing';
import { ENGLISH_STORY_LEXICON, SPANISH_STORY_LEXICON, storyLexicon, writingIn } from './story-lexicon';
import { findQuote, nameTokens } from './ties-step';

const es = SPANISH_STORY_LEXICON;

function entry(name: string, aliases: string[] = [], kind = 'character'): RawNameEntry {
  return { name, aliases, kind, what: '' };
}

describe('story lexicon', () => {
  it('picks the lexicon by language, English for any other', () => {
    expect(storyLexicon('es')).toBe(SPANISH_STORY_LEXICON);
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
});
