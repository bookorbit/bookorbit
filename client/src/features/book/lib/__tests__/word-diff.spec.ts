// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { wordDiff } from '../word-diff'

describe('wordDiff', () => {
  it('marks the words the new text drops and the ones it adds', () => {
    const diff = wordDiff('Twelve-year-old Artemis Fowl is a genius', 'Twelve-year-old Artemis is a young genius')

    expect(diff?.before).toEqual([
      { kind: 'same', text: 'Twelve-year-old Artemis ' },
      { kind: 'removed', text: 'Fowl' },
      { kind: 'same', text: ' is a genius' },
    ])
    expect(diff?.after).toEqual([
      { kind: 'same', text: 'Twelve-year-old Artemis is a ' },
      { kind: 'added', text: 'young' },
      { kind: 'same', text: ' genius' },
    ])
  })

  it('never marks whitespace, so a highlight starts and ends on a word', () => {
    const diff = wordDiff('one two', 'one  three')
    const marked = [...(diff?.before ?? []), ...(diff?.after ?? [])].filter((part) => part.kind !== 'same')

    expect(marked.map((part) => part.text)).toEqual(['two', 'three'])
  })

  it('reports how much of the text the two share', () => {
    expect(wordDiff('a b c d', 'a b c d')?.similarity).toBe(1)
    expect(wordDiff('a b c d', 'w x y z')?.similarity).toBe(0)
    expect(wordDiff('a b c d', 'a b x y')?.similarity).toBe(0.5)
  })

  it('declines texts too long to compare', () => {
    const long = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ')

    expect(wordDiff(long, `${long} more`)).toBeNull()
  })
})
