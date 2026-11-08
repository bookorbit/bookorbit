import { describe, expect, it } from 'vitest';

import { matchesTitleAndAuthor, type HardcoverBookIdentity } from './hardcover-title-author-match';

function hit(title: string | null, authors: string[], subtitle: string | null = null): HardcoverBookIdentity {
  return { title, subtitle, cached_contributors: authors.map((name) => ({ author: { name }, contribution: null })) };
}

describe('matchesTitleAndAuthor', () => {
  describe('title', () => {
    it('matches the same title regardless of case, accents, punctuation and spacing', () => {
      expect(matchesTitleAndAuthor(hit('Les Misérables', ['Victor Hugo']), 'LES   MISERABLES!', 'Victor Hugo')).toBe(true);
    });

    it('treats apostrophes and ampersands as the same title', () => {
      expect(
        matchesTitleAndAuthor(
          hit("Harry Potter and the Philosopher's Stone", ['J.K. Rowling']),
          'Harry Potter and the Philosophers Stone',
          'J.K. Rowling',
        ),
      ).toBe(true);
      expect(matchesTitleAndAuthor(hit('Tom & Jerry', ['Bill Hanna']), 'Tom and Jerry', 'Bill Hanna')).toBe(true);
    });

    it('matches the title joined to its subtitle', () => {
      expect(matchesTitleAndAuthor(hit('Dune', ['Frank Herbert'], 'Deluxe Edition'), 'Dune: Deluxe Edition', 'Frank Herbert')).toBe(true);
      expect(matchesTitleAndAuthor(hit('Dune', ['Frank Herbert'], 'Deluxe Edition'), 'Dune', 'Frank Herbert')).toBe(true);
    });

    it('rejects a different title', () => {
      expect(matchesTitleAndAuthor(hit('Another Book', ['Jim Zub']), 'Samurai Jack', 'Jim Zub')).toBe(false);
    });

    it('rejects a different volume of the same series', () => {
      expect(matchesTitleAndAuthor(hit('Samurai Jack: Volume 1', ['Jim Zub']), 'Samurai Jack: Volume 2', 'Jim Zub')).toBe(false);
      expect(matchesTitleAndAuthor(hit('Samurai Jack 12', ['Jim Zub']), 'Samurai Jack 1', 'Jim Zub')).toBe(false);
    });

    it('rejects a series name when the local book is one volume of it, and the reverse', () => {
      expect(matchesTitleAndAuthor(hit('Batman', ['Jeph Loeb']), 'Batman: Hush', 'Jeph Loeb')).toBe(false);
      expect(matchesTitleAndAuthor(hit('Batman: Hush', ['Jeph Loeb']), 'Batman', 'Jeph Loeb')).toBe(false);
    });

    it('rejects a title that only starts or ends the same way', () => {
      expect(matchesTitleAndAuthor(hit('The Hobbit, or There and Back Again', ['J.R.R. Tolkien']), 'The Hobbit', 'J.R.R. Tolkien')).toBe(false);
    });

    it('compares non-Latin titles instead of normalizing them to nothing', () => {
      expect(matchesTitleAndAuthor(hit('ワンピース', ['尾田栄一郎']), 'ワンピース', '尾田栄一郎')).toBe(true);
      expect(matchesTitleAndAuthor(hit('ナルト', ['尾田栄一郎']), 'ワンピース', '尾田栄一郎')).toBe(false);
      expect(matchesTitleAndAuthor(hit('Война и мир', ['Лев Толстой']), 'война и мир', 'Толстой Лев')).toBe(true);
    });

    it('rejects when either title is empty or unusable', () => {
      expect(matchesTitleAndAuthor(hit(null, ['Jim Zub']), 'Samurai Jack', 'Jim Zub')).toBe(false);
      expect(matchesTitleAndAuthor(hit('', ['Jim Zub']), '', 'Jim Zub')).toBe(false);
      expect(matchesTitleAndAuthor(hit('!!!', ['Jim Zub']), '???', 'Jim Zub')).toBe(false);
    });

    it('rejects over-long text rather than comparing a truncated prefix', () => {
      const shared = 'a'.repeat(600);
      expect(matchesTitleAndAuthor(hit(`${shared} one`, ['Jim Zub']), `${shared} two`, 'Jim Zub')).toBe(false);
      expect(matchesTitleAndAuthor(hit(`${shared} one`, ['Jim Zub']), `${shared} one`, 'Jim Zub')).toBe(false);
    });
  });

  describe('author', () => {
    const title = 'Samurai Jack';

    it('matches the same name written differently', () => {
      expect(matchesTitleAndAuthor(hit(title, ['J.K. Rowling']), title, 'J. K. Rowling')).toBe(true);
      expect(matchesTitleAndAuthor(hit(title, ['J.K. Rowling']), title, 'Rowling, J.K.')).toBe(true);
      expect(matchesTitleAndAuthor(hit(title, ['José Saramago']), title, 'jose saramago')).toBe(true);
    });

    it('matches a name that carries a middle initial on one side', () => {
      expect(matchesTitleAndAuthor(hit(title, ['Brandon Sanderson']), title, 'Brandon W. Sanderson')).toBe(true);
      expect(matchesTitleAndAuthor(hit(title, ['Brandon W. Sanderson']), title, 'Brandon Sanderson')).toBe(true);
    });

    it('matches when any contributor matches, whatever the role', () => {
      const comic: HardcoverBookIdentity = {
        title,
        cached_contributors: [
          { author: { name: 'Jim Zub' }, contribution: null },
          { author: { name: 'Andy Suriano' }, contribution: 'Illustrator' },
        ],
      };
      expect(matchesTitleAndAuthor(comic, title, 'Andy Suriano')).toBe(true);
      expect(matchesTitleAndAuthor(comic, title, 'Jim Zub')).toBe(true);
    });

    it('reads contributors listed by a bare name', () => {
      expect(matchesTitleAndAuthor({ title, cached_contributors: [{ name: 'Jim Zub' }] }, title, 'Jim Zub')).toBe(true);
    });

    it('rejects a different author', () => {
      expect(matchesTitleAndAuthor(hit(title, ['Someone Else']), title, 'Jim Zub')).toBe(false);
    });

    it('rejects a lone surname against a fuller name, and a shared surname alone', () => {
      expect(matchesTitleAndAuthor(hit(title, ['Jim Zub']), title, 'Zub')).toBe(false);
      expect(matchesTitleAndAuthor(hit(title, ['Jim Zub']), title, 'Zub Zub Zub')).toBe(false);
      expect(matchesTitleAndAuthor(hit(title, ['Jim Zub']), title, 'Tim Zub')).toBe(false);
    });

    it('rejects when the book lists no usable contributors', () => {
      expect(matchesTitleAndAuthor({ title }, title, 'Jim Zub')).toBe(false);
      expect(matchesTitleAndAuthor({ title, cached_contributors: null }, title, 'Jim Zub')).toBe(false);
      expect(matchesTitleAndAuthor({ title, cached_contributors: 'Jim Zub' }, title, 'Jim Zub')).toBe(false);
      expect(
        matchesTitleAndAuthor({ title, cached_contributors: [null, 3, {}, { author: { name: 7 } }, { author: { name: '  ' } }] }, title, 'Jim Zub'),
      ).toBe(false);
    });

    it('rejects when the local author is empty or unusable', () => {
      expect(matchesTitleAndAuthor(hit(title, ['Jim Zub']), title, '')).toBe(false);
      expect(matchesTitleAndAuthor(hit(title, ['Jim Zub']), title, '...')).toBe(false);
    });
  });
});
