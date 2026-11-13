import { answerLanguage, cappedAnswer, cleanAnswer, readingHelpPrompt } from './reading-help-prompts';

describe('readingHelpPrompt', () => {
  const passages = ['Mr Darcy walked in.', 'He refused to dance.'];

  it('asks who or what a term is across the book in two sentences, with numbered passages', () => {
    const prompt = readingHelpPrompt({ kind: 'term', language: 'German', term: 'Darcy', scope: 'book', passages });
    expect(prompt.maxSentences).toBe(2);
    expect(prompt.system).toContain('Respond in German.');
    expect(prompt.user).toContain('Selected words: "Darcy"');
    expect(prompt.user).toContain('[1] Mr Darcy walked in.\n\n[2] He refused to dance.');
    expect(prompt.system).toContain('anything you know about this book or its author from elsewhere');
  });

  it('asks what happened in the chapter in up to three sentences', () => {
    const prompt = readingHelpPrompt({ kind: 'term', language: 'English', term: 'Darcy', scope: 'chapter', passages });
    expect(prompt.maxSentences).toBe(3);
    expect(prompt.user).toContain('in this chapter so far');
  });

  it('writes a description with the book prompt, whatever the scope', () => {
    const prompt = readingHelpPrompt({ kind: 'description', language: 'English', term: 'Pemberley', scope: 'chapter', passages });
    expect(prompt.maxSentences).toBe(2);
    expect(prompt.user).toContain('Who or what is "Pemberley"');
  });

  it('takes notes on one passage and recalls where the reader stopped', () => {
    const note = readingHelpPrompt({ kind: 'recap-note', language: 'French', scope: 'book', passages: ['A ball at Netherfield.'] });
    expect(note.maxSentences).toBe(3);
    expect(note.user).toContain('Passage:\nA ball at Netherfield.');
    expect(note.system).toContain('Respond in French.');

    const stop = readingHelpPrompt({ kind: 'recap-stop', language: 'English', scope: 'book', passages: ['Elizabeth reads the letter.'] });
    expect(stop.maxSentences).toBe(3);
    expect(stop.user).toContain('Pages:\nElizabeth reads the letter.');
  });

  it('never names a book or an author', () => {
    for (const kind of ['term', 'description', 'recap-note', 'recap-stop'] as const) {
      const prompt = readingHelpPrompt({ kind, language: 'English', term: 'X', scope: 'book', passages: ['P'] });
      expect(prompt.system).not.toMatch(/\{|\}|undefined/);
      expect(prompt.user).not.toMatch(/undefined/);
    }
  });
});

describe('answerLanguage', () => {
  it('names a language in English, and falls back to English for nonsense', () => {
    expect(answerLanguage('de')).toBe('German');
    expect(answerLanguage('zh-Hans')).toContain('Chinese');
    expect(answerLanguage('pt-BR')).toContain('Portuguese');
    expect(answerLanguage('qqq')).toBe('English');
  });
});

describe('cappedAnswer', () => {
  it('waits until a sentence beyond the cap has begun', () => {
    expect(cappedAnswer('Darcy is proud. He owns Pemberley', 2, 'en')).toBeNull();
    expect(cappedAnswer('Darcy is proud. He owns Pemberley. He', 2, 'en')).toBe('Darcy is proud. He owns Pemberley.');
  });

  it('ignores whitespace between sentences and reads other scripts', () => {
    expect(cappedAnswer('One.   Two.  ', 2, 'en')).toBeNull();
    expect(cappedAnswer('他很骄傲。他住在彭伯里。后来', 2, 'zh-Hans')).toBe('他很骄傲。他住在彭伯里。');
  });

  it('keeps a title or an initial inside its sentence', () => {
    expect(cappedAnswer('Mr. Darcy is proud. He owns Pemberley', 2, 'en')).toBeNull();
    expect(cappedAnswer('Mr. Darcy is proud. Mrs. Bennet is not. Dr. Jones', 2, 'en')).toBe('Mr. Darcy is proud. Mrs. Bennet is not.');
    expect(cappedAnswer('J. R. R. Tolkien wrote it. Then he left. And', 2, 'en')).toBe('J. R. R. Tolkien wrote it. Then he left.');
    expect(cappedAnswer('They met Mr. Bingley. He danced. St.', 2, 'en')).toBe('They met Mr. Bingley. He danced.');
  });

  it('falls back to English rules for a tag Intl cannot read', () => {
    expect(cappedAnswer('One. Two. Three', 2, 'not a tag')).toBe('One. Two.');
  });
});

describe('cleanAnswer', () => {
  it('removes bold markers and surrounding space', () => {
    expect(cleanAnswer('  **Darcy** is proud. ')).toBe('Darcy is proud.');
  });
});
