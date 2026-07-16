import { parsePdfInfoOutput } from './pdf-poppler-metadata';

describe('parsePdfInfoOutput', () => {
  it('extracts metadata fields from pdfinfo output', () => {
    const parsed = parsePdfInfoOutput(`
Title:           Lonely Planet - Southern Italy
Keywords:        Magazine, Travel
Author:          Lonely Planet
Subject:         Travel guide
Creator:         Adobe InDesign CS6 (Windows)
Producer:        Adobe PDF Library 10.0.1
Pages:           299
Encrypted:       yes (print:yes copy:no change:no addNotes:yes algorithm:RC4)
`);

    expect(parsed).toEqual({
      title: 'Lonely Planet - Southern Italy',
      author: 'Lonely Planet',
      subject: 'Travel guide',
      keywords: 'Magazine, Travel',
      creator: 'Adobe InDesign CS6 (Windows)',
      producer: 'Adobe PDF Library 10.0.1',
      pageCount: 299,
    });
  });

  it('returns nulls for missing or blank fields', () => {
    const parsed = parsePdfInfoOutput(`
Title:
Pages:           unknown
`);

    expect(parsed).toEqual({
      title: null,
      author: null,
      subject: null,
      keywords: null,
      creator: null,
      producer: null,
      pageCount: null,
    });
  });
});
