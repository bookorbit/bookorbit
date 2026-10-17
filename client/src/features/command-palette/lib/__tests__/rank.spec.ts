// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { rankBooks } from '../rank'

function book(id: number, title: string): BookCard {
  return { id, title } as BookCard
}

describe('rankBooks', () => {
  it('puts titles that start with the query ahead of narrator or author matches the server sorted first', () => {
    const books = [book(1, 'Bad Bishop'), book(2, 'Carrie'), book(3, 'King of Ashes'), book(4, 'King Sorrow')]

    expect(rankBooks(books, 'king').map((entry) => entry.id)).toEqual([3, 4, 1, 2])
  })

  it('ranks a word-start match above a match inside a word, and keeps server order within a rank', () => {
    const books = [book(1, 'Unkingly'), book(2, 'The Return of the King'), book(3, 'The Kingdom of Copper')]

    expect(rankBooks(books, 'king').map((entry) => entry.id)).toEqual([2, 3, 1])
  })

  it('matches case-insensitively and leaves the input untouched', () => {
    const books = [book(1, 'Carrie'), book(2, 'KING SORROW')]

    expect(rankBooks(books, '  King ').map((entry) => entry.id)).toEqual([2, 1])
    expect(books.map((entry) => entry.id)).toEqual([1, 2])
  })

  it('returns the books in server order for a blank query', () => {
    const books = [book(1, 'B'), book(2, 'A')]

    expect(rankBooks(books, '   ').map((entry) => entry.id)).toEqual([1, 2])
  })
})
