import { describe, expect, it } from 'vitest';

import { DOCK_FOLDER_NAME_MAX_BYTES, cleanDockFolderName, sanitizeDockFolderName, uniqueDockFolderName } from './library-dock-folder-name';

describe('sanitizeDockFolderName', () => {
  it('keeps an ordinary library name as it is', () => {
    expect(sanitizeDockFolderName('Fiction', 1)).toBe('Fiction');
    expect(sanitizeDockFolderName('Non-fiction & Essays', 1)).toBe('Non-fiction & Essays');
  });

  it.each([
    ['Sci/Fi', 'SciFi'],
    ['Sci / Fi', 'Sci Fi'],
    ['Back\\slash', 'Backslash'],
    ['What: Why?', 'What Why'],
    ['"Quoted" <angle> |pipe| *star*', 'Quoted angle pipe star'],
    ['Tab\tand\nnewline', 'Tab and newline'],
    ['Bell\u0007and\u009bC1', 'BellandC1'],
  ])('drops characters a share cannot hold: %j', (input, expected) => {
    expect(sanitizeDockFolderName(input, 1)).toBe(expected);
  });

  it('trims trailing dots and spaces, and leading dots that would hide the folder', () => {
    expect(sanitizeDockFolderName('Comics. . ', 1)).toBe('Comics');
    expect(sanitizeDockFolderName('...Hidden', 1)).toBe('Hidden');
    expect(sanitizeDockFolderName('   Padded   ', 1)).toBe('Padded');
  });

  it('collapses runs of whitespace', () => {
    expect(sanitizeDockFolderName('Big    Library', 1)).toBe('Big Library');
  });

  it.each([
    ['CON', 'CON_'],
    ['nul', 'nul_'],
    ['Com1', 'Com1_'],
    ['LPT9', 'LPT9_'],
    ['CON.old', 'CON_.old'],
  ])('steps around the Windows reserved name %s', (input, expected) => {
    expect(sanitizeDockFolderName(input, 1)).toBe(expected);
  });

  it('leaves names that only start like a reserved one alone', () => {
    expect(sanitizeDockFolderName('Console games', 1)).toBe('Console games');
    expect(sanitizeDockFolderName('COM10', 1)).toBe('COM10');
  });

  it('normalises to NFC so a decomposed accent and a composed one are the same folder', () => {
    const decomposed = 'Café';
    const name = sanitizeDockFolderName(decomposed, 1);
    expect(name).toBe('Café');
    expect(sanitizeDockFolderName('Café', 2, [name])).toBe('Café (2)');
  });

  it('keeps emoji and non-Latin scripts', () => {
    expect(sanitizeDockFolderName('📚 Books', 1)).toBe('📚 Books');
    expect(sanitizeDockFolderName('漫画', 1)).toBe('漫画');
  });

  it(`caps the name at ${DOCK_FOLDER_NAME_MAX_BYTES} bytes without splitting a character`, () => {
    const name = sanitizeDockFolderName('é'.repeat(80), 1);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(DOCK_FOLDER_NAME_MAX_BYTES);
    expect(name).toBe('é'.repeat(50));
    const emoji = sanitizeDockFolderName('📚'.repeat(30), 1);
    expect(Buffer.byteLength(emoji)).toBe(100);
    expect([...emoji].every((c) => c === '📚')).toBe(true);
  });

  it('re-trims after the cap so the cut never ends in a space or a dot', () => {
    const name = sanitizeDockFolderName(`${'a'.repeat(98)} .tail`, 1);
    expect(name).toBe('a'.repeat(98));
  });

  it.each(['', '   ', '...', '///', '\u0000', '@eaDir', 'Thumbs.db', 'lost+found', '#recycle'])(
    'falls back to library-<id> when nothing usable is left: %j',
    (input) => {
      expect(sanitizeDockFolderName(input, 42)).toBe('library-42');
    },
  );

  it('adds a numbered suffix on a case-insensitive clash', () => {
    expect(sanitizeDockFolderName('Fiction', 1, ['fiction'])).toBe('Fiction (2)');
    expect(sanitizeDockFolderName('Fiction', 1, ['Fiction', 'FICTION (2)'])).toBe('Fiction (3)');
  });

  it('suffixes the fallback name too when it is taken', () => {
    expect(sanitizeDockFolderName('', 7, ['library-7'])).toBe('library-7 (2)');
  });
});

describe('cleanDockFolderName', () => {
  it('returns an empty string when nothing usable is left', () => {
    expect(cleanDockFolderName('***')).toBe('');
  });

  it('returns a valid name unchanged, so a typed name can be checked by comparing', () => {
    for (const name of ['Fiction', 'Manga', 'Kids 2024', '📚 Books']) expect(cleanDockFolderName(name)).toBe(name);
  });
});

describe('uniqueDockFolderName', () => {
  it('keeps the suffixed name within the byte cap', () => {
    const base = 'b'.repeat(DOCK_FOLDER_NAME_MAX_BYTES);
    const name = uniqueDockFolderName(base, [base]);
    expect(name.endsWith(' (2)')).toBe(true);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(DOCK_FOLDER_NAME_MAX_BYTES);
  });
});
