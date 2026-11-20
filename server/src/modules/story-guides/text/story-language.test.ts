import { readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';

import { detectLanguage, isStoryGuideLanguage, normaliseLanguage, storyLanguage } from './story-language';

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, '..', 'test-fixtures', 'expected', 'a-study-in-scarlet.epub.json.gz'))).toString('utf8'),
) as { sections: { text: string }[] };
const english = fixture.sections.map((section) => section.text).filter((text) => text.length > 2000);

const french = [
  'Le matin était clair et la ville dormait encore. Elle marchait dans la rue avec son frère, et ils ne parlaient pas. ' +
    'Il avait peur de ce que leur père dirait, mais elle savait que la lettre était arrivée pour une raison. ' +
    'Dans la maison, les fenêtres étaient ouvertes et le vent passait sur la table où nous avions laissé des livres. ',
].map((text) => text.repeat(30));
const spanish = [
  'La mañana era clara y la ciudad todavía dormía. Ella caminaba por la calle con su hermano, y no hablaban. ' +
    'Él tenía miedo de lo que diría su padre, pero ella sabía que la carta había llegado por una razón. ' +
    'En la casa, las ventanas estaban abiertas y el viento pasaba sobre la mesa donde habíamos dejado los libros. ',
].map((text) => text.repeat(30));
const russian = ['Утро было ясным, и город ещё спал. Она шла по улице со своим братом, и они молчали. '.repeat(60)];

describe('story language', () => {
  it.each([
    ['en', 'en'],
    ['en-GB', 'en'],
    ['EN_us', 'en'],
    ['eng', 'en'],
    ['fra', 'fr'],
    ['fre', 'fr'],
    ['ger', 'de'],
    ['zho', 'zh'],
    ['English', 'en'],
    ['Français', 'fr'],
    ['francais', 'fr'],
    ['Deutsch', 'de'],
    ['und', null],
    ['mul', null],
    ['', null],
    ['  ', null],
    ['12', null],
    ['Klingonese', null],
  ])('reads %j as %j', (value, code) => {
    expect(normaliseLanguage(value)).toBe(code);
  });

  it('tells English, French and Spanish text apart by common words', () => {
    expect(detectLanguage(english)).toBe('en');
    expect(detectLanguage(french)).toBe('fr');
    expect(detectLanguage(spanish)).toBe('es');
    expect(detectLanguage(russian)).toBeNull();
    expect(detectLanguage(['too short'])).toBeNull();
  });

  it('uses the metadata when the text agrees or cannot tell', () => {
    expect(storyLanguage(['en'], english)).toBe('en');
    expect(storyLanguage(['und', 'English'], english)).toBe('en');
    expect(storyLanguage(['en'], ['short'])).toBe('en');
    expect(storyLanguage(['es-MX'], spanish)).toBe('es');
    expect(storyLanguage(['ru'], russian)).toBe('ru');
  });

  it('detects the language when the metadata names none', () => {
    expect(storyLanguage([], english)).toBe('en');
    expect(storyLanguage(['und'], english)).toBe('en');
    expect(storyLanguage([], spanish)).toBe('es');
    expect(storyLanguage([], ['short'])).toBe('und');
  });

  it('goes by the text for a mislabelled book', () => {
    expect(storyLanguage(['fr'], english)).toBe('en');
    expect(storyLanguage(['en'], french)).toBe('fr');
    expect(storyLanguage(['en'], spanish)).toBe('es');
    expect(storyLanguage(['en'], russian)).toBe('und');
  });

  it('builds guides in English and Spanish only', () => {
    expect(isStoryGuideLanguage('en')).toBe(true);
    expect(isStoryGuideLanguage('es')).toBe(true);
    expect(isStoryGuideLanguage('fr')).toBe(false);
    expect(isStoryGuideLanguage('pt')).toBe(false);
    expect(isStoryGuideLanguage('und')).toBe(false);
    expect(isStoryGuideLanguage(null)).toBe(false);
  });
});
