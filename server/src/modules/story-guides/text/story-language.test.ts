import { readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';

import { detectLanguage, normaliseLanguage, storyLanguage } from './story-language';

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, '..', 'test-fixtures', 'expected', 'a-study-in-scarlet.epub.json.gz'))).toString('utf8'),
) as { sections: { text: string }[] };
const english = fixture.sections.map((section) => section.text).filter((text) => text.length > 2000);

const french = [
  'Le matin était clair et la ville dormait encore. Elle marchait dans la rue avec son frère, et ils ne parlaient pas. ' +
    'Il avait peur de ce que leur père dirait, mais elle savait que la lettre était arrivée pour une raison. ' +
    'Dans la maison, les fenêtres étaient ouvertes et le vent passait sur la table où nous avions laissé des livres. ',
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

  it('tells English and French text apart by common words', () => {
    expect(detectLanguage(english)).toBe('en');
    expect(detectLanguage(french)).toBe('fr');
    expect(detectLanguage(russian)).toBeNull();
    expect(detectLanguage(['too short'])).toBeNull();
  });

  it('uses the metadata when the text agrees or cannot tell', () => {
    expect(storyLanguage(['en'], english)).toEqual({ language: 'en' });
    expect(storyLanguage(['und', 'English'], english)).toEqual({ language: 'en' });
    expect(storyLanguage(['en'], ['short'])).toEqual({ language: 'en' });
  });

  it('detects the language when the metadata names none', () => {
    expect(storyLanguage([], english)).toEqual({ language: 'en' });
    expect(storyLanguage(['und'], english)).toEqual({ language: 'en' });
    expect(storyLanguage([], ['short'])).toEqual({ language: null, reason: 'language' });
  });

  it('goes by the text for a mislabelled book', () => {
    expect(storyLanguage(['fr'], english)).toEqual({ language: 'en' });
    expect(storyLanguage(['en'], french)).toEqual({ language: null, reason: 'language' });
    expect(storyLanguage(['en'], russian)).toEqual({ language: null, reason: 'language' });
  });

  it('refuses a language outside the supported list', () => {
    expect(storyLanguage(['fr'], french)).toEqual({ language: null, reason: 'language' });
    expect(storyLanguage(['ru'], russian)).toEqual({ language: null, reason: 'language' });
  });
});
