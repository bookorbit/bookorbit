import { describe, expect, it } from 'vitest'
import { libroFmAudiobookUrl } from '../provider-links'

describe('provider links', () => {
  it('builds a trimmed and encoded Libro.fm audiobook URL', () => {
    expect(libroFmAudiobookUrl(' 978 123 ')).toBe('https://libro.fm/audiobooks/978%20123')
  })
})
