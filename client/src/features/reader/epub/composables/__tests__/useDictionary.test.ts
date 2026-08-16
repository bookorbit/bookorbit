import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FREE_DICT_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/hello'
const WIKTIONARY_EN_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition/hello'
const WIKTIONARY_FR_URL = 'https://fr.wiktionary.org/api/rest_v1/page/definition/bonjour'

function makeFreeDictResponse(word = 'hello', overrides: Record<string, unknown> = {}) {
  return [
    {
      word,
      phonetic: '/həˈloʊ/',
      phonetics: [{ text: '/həˈloʊ/', audio: 'https://audio.example.com/hello.mp3' }, { text: '/hɛˈloʊ/' }],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [{ definition: 'An expression of greeting.', example: 'She said hello.' }, { definition: 'A call to attract attention.' }],
        },
        {
          partOfSpeech: 'verb',
          definitions: [{ definition: 'To greet with "hello".' }],
        },
      ],
      ...overrides,
    },
  ]
}

/** Wiktionary keys its response by language; tests must supply the section they ask for. */
function makeWiktionaryResponse(lang = 'fr', overrides: Record<string, unknown> = {}) {
  return {
    [lang]: [
      {
        partOfSpeech: 'Noun',
        definitions: [
          {
            definition: '<span>A greeting</span>.',
            examples: [{ text: '<b>Hello</b> there.' }],
          },
          { definition: 'A call for attention.', examples: [] },
        ],
      },
    ],
    ...overrides,
  }
}

/** One Wiktionary "page" of English noun senses, for chain fixtures. */
function enNoun(...definitions: string[]) {
  return { en: [{ partOfSpeech: 'Noun', definitions: definitions.map((definition) => ({ definition, examples: [] })) }] }
}

describe('useDictionary', () => {
  let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

  beforeEach(() => {
    fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function load() {
    const mod = await import('../useDictionary')
    return mod.useDictionary()
  }

  function mockOk(data: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => data,
    } as unknown as Response
  }

  function mockStatus(status: number): Response {
    return {
      ok: false,
      status,
      json: async () => ({}),
    } as unknown as Response
  }

  /** Serves a fixed set of Wiktionary pages by word, 404ing anything else. */
  function serveWiktionary(pages: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input) => {
      const word = decodeURIComponent(String(input).split('/definition/')[1] ?? '')
      return word in pages ? mockOk(pages[word]) : mockStatus(404)
    })
  }

  /** Serves a fixed set of Free Dictionary pages by word, 404ing anything else. */
  function serveFreeDictionary(pages: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input) => {
      const word = decodeURIComponent(String(input).split('/entries/en/')[1] ?? '')
      return word in pages ? mockOk(pages[word]) : mockStatus(404)
    })
  }

  /** Words asked of Wiktionary, ignoring the Free Dictionary probe an English lookup makes first. */
  function requestedWords() {
    return fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('wiktionary.org'))
      .map((url) => decodeURIComponent(url.split('/definition/')[1] ?? ''))
  }

  // -------------------------------------------------------------------------
  // English - Free Dictionary success path
  // -------------------------------------------------------------------------

  it('English: returns normalized result from Free Dictionary on success', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')

    expect(result).not.toBeNull()
    expect(result!.word).toBe('hello')
    expect(result!.provider).toBe('free-dictionary')
    expect(result!.entries).toHaveLength(2)
    expect(result!.entries[0]!.partOfSpeech).toBe('noun')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('An expression of greeting.')
    expect(result!.entries[0]!.definitions[0]!.example).toBe('She said hello.')
    expect(result!.entries[1]!.partOfSpeech).toBe('verb')
  })

  it('English: extracts phonetic text preferring the entry with audio', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.phonetic).toBe('/həˈloʊ/')
  })

  it('English: extracts audio URL from phonetics', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.audioUrl).toBe('https://audio.example.com/hello.mp3')
  })

  it('English: uses phonetic text from phonetics entry when no top-level phonetic and entry has no audio', async () => {
    const data = makeFreeDictResponse('test', {
      phonetic: undefined,
      phonetics: [{ text: '/tɛst/' }], // text present, no audio
    })
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.phonetic).toBe('/tɛst/')
    expect(result!.audioUrl).toBeNull()
  })

  it('English: falls back to top-level phonetic when phonetics array has no audio', async () => {
    const data = makeFreeDictResponse('test', {
      phonetic: '/tɛst/',
      phonetics: [{ text: '/tɛst/' }],
    })
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.phonetic).toBe('/tɛst/')
    expect(result!.audioUrl).toBeNull()
  })

  it('English: phonetic and audioUrl are null when phonetics array is empty and no top-level phonetic', async () => {
    const data = makeFreeDictResponse('test', { phonetic: undefined, phonetics: [] })
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.phonetic).toBeNull()
    expect(result!.audioUrl).toBeNull()
  })

  it('English: definition example is null when not present in Free Dictionary entry', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk(
        makeFreeDictResponse('test', {
          meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A test.' }] }],
        }),
      ),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  // -------------------------------------------------------------------------
  // English - Free Dictionary 404, fallback to Wiktionary
  // -------------------------------------------------------------------------

  it('English: returns null when Free Dictionary entry has no meanings', async () => {
    const data = makeFreeDictResponse('test', { meanings: [] })
    fetchMock.mockResolvedValueOnce(mockOk(data)).mockResolvedValueOnce(mockStatus(404)) // Wiktionary fallback also 404
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result).toBeNull()
  })

  it('English: uses input word when Free Dictionary word field is not a string', async () => {
    const data = [{ ...makeFreeDictResponse()[0], word: 42 }]
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.word).toBe('hello')
  })

  it('English: falls back to Wiktionary when Free Dictionary returns 404', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404)).mockResolvedValueOnce(mockOk(makeWiktionaryResponse('en')))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')

    expect(result).not.toBeNull()
    expect(result!.provider).toBe('wiktionary')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0]).toBe(FREE_DICT_URL)
    expect(fetchMock.mock.calls[1]![0]).toBe(WIKTIONARY_EN_URL)
  })

  it('English: falls back to Wiktionary when Free Dictionary throws a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce(mockOk(makeWiktionaryResponse('en')))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')

    expect(result!.provider).toBe('wiktionary')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('English: falls back to Wiktionary when Free Dictionary returns a non-404 server error', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(500)).mockResolvedValueOnce(mockOk(makeWiktionaryResponse('en')))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.provider).toBe('wiktionary')
  })

  it('English: falls back to Wiktionary when Free Dictionary returns empty array', async () => {
    fetchMock.mockResolvedValueOnce(mockOk([])).mockResolvedValueOnce(mockOk(makeWiktionaryResponse('en')))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.provider).toBe('wiktionary')
  })

  it('English: falls back to Wiktionary when Free Dictionary returns non-array response', async () => {
    fetchMock.mockResolvedValueOnce(mockOk({ title: 'No Definitions Found' })).mockResolvedValueOnce(mockOk(makeWiktionaryResponse('en')))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.provider).toBe('wiktionary')
  })

  // -------------------------------------------------------------------------
  // English - both APIs return not found
  // -------------------------------------------------------------------------

  it('English: returns null when both Free Dictionary and Wiktionary return 404', async () => {
    fetchMock.mockResolvedValue(mockStatus(404))
    const { lookup } = await load()
    const result = await lookup('zzzzunknownword', 'en')
    expect(result).toBeNull()
  })

  it('English: returns null when Free Dictionary 404s and Wiktionary returns empty entries', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404)).mockResolvedValueOnce(mockOk({ en: [] }))
    const { lookup } = await load()
    const result = await lookup('zzz', 'en')
    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Non-English
  // -------------------------------------------------------------------------

  it('Non-English: calls Wiktionary directly without calling Free Dictionary', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse('fr')))
    const { lookup } = await load()
    await lookup('bonjour', 'fr')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(WIKTIONARY_FR_URL)
  })

  it('Non-English: returns normalized Wiktionary result', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse('fr')))
    const { lookup } = await load()
    const result = await lookup('bonjour', 'fr')

    expect(result).not.toBeNull()
    expect(result!.provider).toBe('wiktionary')
    expect(result!.entries.length).toBeGreaterThan(0)
  })

  it('Non-English: returns null when Wiktionary returns 404', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404))
    const { lookup } = await load()
    const result = await lookup('xyz', 'de')
    expect(result).toBeNull()
  })

  it('Non-English: throws when Wiktionary returns server error', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(500))
    const { lookup } = await load()
    await expect(lookup('xyz', 'de')).rejects.toThrow('Wiktionary API error: 500')
  })

  // -------------------------------------------------------------------------
  // Language sectioning (issue #1020: Latin senses leaked into English lookups)
  // -------------------------------------------------------------------------

  it('Wiktionary: returns only the requested language section', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404)).mockResolvedValueOnce(
      mockOk({
        en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A single candelabrum.', examples: [] }] }],
        la: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'nominative/accusative/vocative plural of candēlābrum', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('candelabra', 'en')

    expect(result!.entries).toHaveLength(1)
    expect(result!.entries[0]!.definitions.map((d) => d.definition)).toEqual(['A single candelabrum.'])
  })

  it('Wiktionary: does not fall back to another language section when the requested one is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'English meaning.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'de')
    expect(result).toBeNull()
  })

  it('Wiktionary: returns null when the requested language section is not an array', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: 'not-an-array',
        en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A greeting.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Inflection pointers - words the reader looked up that only point elsewhere
  // -------------------------------------------------------------------------

  it('pointer: follows a plural to the word that carries the definition', async () => {
    serveWiktionary({
      mice: enNoun('plural of mouse'),
      mouse: enNoun('Any small rodent of the genus Mus.'),
    })
    const { lookup } = await load()
    const result = await lookup('mice', 'en')

    expect(result!.entries.map((e) => [e.sourceWord, e.definitions[0]!.definition])).toEqual([
      ['mice', 'plural of mouse'],
      ['mouse', 'Any small rodent of the genus Mus.'],
    ])
  })

  it('pointer: follows a two-hop chain (issue #1020 candelabras case)', async () => {
    serveWiktionary({
      candelabras: enNoun('plural of candelabra'),
      candelabra: enNoun('plural of candelabrum', 'A single candelabrum.'),
      candelabrum: enNoun('A candle holder with branches to hold more than one candle.'),
    })
    const { lookup } = await load()
    const result = await lookup('candelabras', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['candelabras', 'candelabra', 'candelabrum'])
    expect(result!.entries.at(-1)!.definitions[0]!.definition).toBe('A candle holder with branches to hold more than one candle.')
  })

  it.each([
    ['plural of walk', 'walk'],
    ['simple past and past participle of walk', 'walk'],
    ['present participle and gerund of run', 'run'],
    ['third-person singular simple present indicative of leave', 'leave'],
    ['Alternative spelling of theater.', 'theater'],
    ['Obsolete form of over.', 'over'],
    ['genitive singular of wolf', 'wolf'],
    ['(informal) plural of datum', 'datum'],
  ])('pointer: recognises %j as pointing at %j', async (pointer, lemma) => {
    serveWiktionary({ probe: enNoun(pointer), [lemma]: enNoun('The real meaning.') })
    const { lookup } = await load()
    const result = await lookup('probe', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['probe', lemma])
  })

  it.each([
    ['A collection of sheets of paper bound together.'],
    ['Informal form of address used by juniors.'],
    ['An act or instance of running.'],
    ['One of the two halves of a whole.'],
    ['plural of ice cream'],
    ['The state of being present.'],
  ])('pointer: leaves the real definition %j alone', async (definition) => {
    serveWiktionary({ probe: enNoun(definition) })
    const { lookup } = await load()
    const result = await lookup('probe', 'en')

    expect(result!.entries).toHaveLength(1)
    expect(requestedWords()).toEqual(['probe'])
  })

  it('pointer: ignores a pointer that is not the leading sense of its block', async () => {
    // "book" leads with a real definition; "simple past of bake" is sense 10 and is trivia.
    serveWiktionary({
      book: enNoun('A collection of sheets of paper bound together.', 'simple past of bake'),
      bake: enNoun('To cook in an oven.'),
    })
    const { lookup } = await load()
    const result = await lookup('book', 'en')

    expect(result!.entries).toHaveLength(1)
    expect(requestedWords()).toEqual(['book'])
  })

  it('pointer: follows the leading pointer of each part-of-speech block', async () => {
    serveWiktionary({
      leaves: {
        en: [
          { partOfSpeech: 'Noun', definitions: [{ definition: 'plural of leaf', examples: [] }] },
          { partOfSpeech: 'Verb', definitions: [{ definition: 'third-person singular simple present indicative of leave', examples: [] }] },
        ],
      },
      leaf: enNoun('A flattened organ of a plant.'),
      leave: enNoun('To depart.'),
    })
    const { lookup } = await load()
    const result = await lookup('leaves', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['leaves', 'leaves', 'leaf', 'leave'])
  })

  it('pointer: does not follow a word that points at itself', async () => {
    serveWiktionary({ ditto: enNoun('plural of ditto') })
    const { lookup } = await load()
    const result = await lookup('ditto', 'en')

    expect(result!.entries).toHaveLength(1)
    expect(requestedWords()).toEqual(['ditto'])
  })

  it('pointer: survives a cycle between two words', async () => {
    serveWiktionary({
      alpha: enNoun('plural of beta'),
      beta: enNoun('plural of alpha'),
    })
    const { lookup } = await load()
    const result = await lookup('alpha', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['alpha', 'beta'])
    expect(requestedWords()).toEqual(['alpha', 'beta'])
  })

  it('pointer: stops after the maximum chain depth', async () => {
    serveWiktionary({
      one: enNoun('plural of two'),
      two: enNoun('plural of three'),
      three: enNoun('plural of four'),
      four: enNoun('The real meaning.'),
    })
    const { lookup } = await load()
    const result = await lookup('one', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['one', 'two', 'three'])
    expect(requestedWords()).not.toContain('four')
  })

  it('pointer: caps how many lemmas a single lookup may fetch', async () => {
    serveWiktionary({
      many: {
        en: [
          { partOfSpeech: 'Noun', definitions: [{ definition: 'plural of alpha', examples: [] }] },
          { partOfSpeech: 'Verb', definitions: [{ definition: 'plural of bravo', examples: [] }] },
          { partOfSpeech: 'Adjective', definitions: [{ definition: 'plural of charlie', examples: [] }] },
          { partOfSpeech: 'Adverb', definitions: [{ definition: 'plural of delta', examples: [] }] },
        ],
      },
      alpha: enNoun('First.'),
      bravo: enNoun('Second.'),
      charlie: enNoun('Third.'),
      delta: enNoun('Fourth.'),
    })
    const { lookup } = await load()
    await lookup('many', 'en')

    expect(requestedWords()).toEqual(['many', 'alpha', 'bravo', 'charlie'])
  })

  it('pointer: a lemma that 404s still leaves the primary result intact', async () => {
    serveWiktionary({ mice: enNoun('plural of mouse') })
    const { lookup } = await load()
    const result = await lookup('mice', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['mice'])
    expect(requestedWords()).toEqual(['mice', 'mouse'])
  })

  it('pointer: a lemma that throws still leaves the primary result intact', async () => {
    fetchMock.mockImplementation(async (input) => {
      const word = decodeURIComponent(String(input).split('/definition/')[1] ?? '')
      if (word === 'mice') return mockOk(enNoun('plural of mouse'))
      throw new Error('network error')
    })
    const { lookup } = await load()
    const result = await lookup('mice', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['mice'])
  })

  it('pointer: a lemma that 500s still leaves the primary result intact', async () => {
    fetchMock.mockImplementation(async (input) => {
      const word = decodeURIComponent(String(input).split('/definition/')[1] ?? '')
      return word === 'mice' ? mockOk(enNoun('plural of mouse')) : mockStatus(500)
    })
    const { lookup } = await load()
    const result = await lookup('mice', 'en')

    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['mice'])
  })

  it('pointer: resolves lemmas on the same Wiktionary subdomain', async () => {
    serveWiktionary({ mice: enNoun('plural of mouse'), mouse: enNoun('A small rodent.') })
    const { lookup } = await load()
    await lookup('mice', 'en')

    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('wiktionary'))).toEqual([
      'https://en.wiktionary.org/api/rest_v1/page/definition/mice',
      'https://en.wiktionary.org/api/rest_v1/page/definition/mouse',
    ])
  })

  it('pointer: leaves non-English inflection glosses alone', async () => {
    // fr.wiktionary writes its glosses in French ("pluriel de chat"). Pointer
    // detection is deliberately English-only, so these are shown as-is rather
    // than guessed at. Non-English lookups still benefit from language filtering.
    fetchMock.mockResolvedValueOnce(mockOk({ fr: [{ partOfSpeech: 'Nom', definitions: [{ definition: 'pluriel de chat', examples: [] }] }] }))
    const { lookup } = await load()
    const result = await lookup('chats', 'fr')

    expect(result!.entries).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pointer: resolves lemmas through Free Dictionary when that provider answered', async () => {
    serveFreeDictionary({
      mice: [{ word: 'mice', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'plural of mouse' }] }] }],
      mouse: [{ word: 'mouse', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A small rodent.' }] }] }],
    })
    const { lookup } = await load()
    const result = await lookup('mice', 'en')

    expect(result!.provider).toBe('free-dictionary')
    expect(result!.entries.map((e) => e.sourceWord)).toEqual(['mice', 'mouse'])
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('api.dictionaryapi.dev'))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Source word attribution
  // -------------------------------------------------------------------------

  it('sourceWord: root entries are attributed to the looked-up word', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.entries.every((e) => e.sourceWord === 'hello')).toBe(true)
  })

  it('sourceWord: uses the canonical word the provider reported, not the raw input', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse('Hello')))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.word).toBe('Hello')
    expect(result!.entries[0]!.sourceWord).toBe('Hello')
  })

  // -------------------------------------------------------------------------
  // Block merging and sense caps
  // -------------------------------------------------------------------------

  it('merge: collapses blocks that share a part of speech', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          word: 'candelabra',
          meanings: [
            { partOfSpeech: 'noun', definitions: [{ definition: 'A single candelabrum.' }] },
            { partOfSpeech: 'noun', definitions: [{ definition: 'A candle holder.' }] },
          ],
        },
      ]),
    )
    const { lookup } = await load()
    const result = await lookup('candelabra', 'en')

    expect(result!.entries).toHaveLength(1)
    expect(result!.entries[0]!.definitions.map((d) => d.definition)).toEqual(['A single candelabrum.', 'A candle holder.'])
  })

  it('merge: keeps distinct parts of speech separate and in first-seen order', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          word: 'run',
          meanings: [
            { partOfSpeech: 'verb', definitions: [{ definition: 'To move swiftly.' }] },
            { partOfSpeech: 'noun', definitions: [{ definition: 'An act of running.' }] },
            { partOfSpeech: 'verb', definitions: [{ definition: 'To operate.' }] },
          ],
        },
      ]),
    )
    const { lookup } = await load()
    const result = await lookup('run', 'en')

    expect(result!.entries.map((e) => e.partOfSpeech)).toEqual(['verb', 'noun'])
    expect(result!.entries[0]!.definitions).toHaveLength(2)
  })

  it('cap: limits how many senses a single part-of-speech block renders', async () => {
    serveWiktionary({ mouse: enNoun('One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.') })
    fetchMock.mockResolvedValueOnce(mockStatus(404))
    const { lookup } = await load()
    const result = await lookup('mouse', 'en')

    expect(result!.entries[0]!.definitions.map((d) => d.definition)).toEqual(['One.', 'Two.', 'Three.', 'Four.', 'Five.'])
  })

  it('cap: applies per block rather than across the whole result', async () => {
    serveWiktionary({
      probe: {
        en: [
          { partOfSpeech: 'Noun', definitions: Array.from({ length: 6 }, (_, i) => ({ definition: `Noun ${i}.`, examples: [] })) },
          { partOfSpeech: 'Verb', definitions: Array.from({ length: 6 }, (_, i) => ({ definition: `Verb ${i}.`, examples: [] })) },
        ],
      },
    })
    const { lookup } = await load()
    const result = await lookup('probe', 'en')

    expect(result!.entries.map((e) => e.definitions.length)).toEqual([5, 5])
  })

  // -------------------------------------------------------------------------
  // HTML stripping in Wiktionary definitions
  // -------------------------------------------------------------------------

  it('Wiktionary: strips HTML tags from definition strings', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: '<span class="term">A greeting</span> used daily.', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hello', 'fr')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('A greeting used daily.')
  })

  it('Wiktionary: decodes HTML entities in definitions', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A &amp; B &lt;test&gt; &quot;quoted&quot; &apos;apos&apos;', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe(`A & B <test> "quoted" 'apos'`)
  })

  it('Wiktionary: decodes numeric HTML entities', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'Say &#39;hi&#39;', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe("Say 'hi'")
  })

  it('Wiktionary: strips script tags and their content from definitions', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'Normal text.<script>alert(1)</script>', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    const def = result!.entries[0]!.definitions[0]!.definition
    expect(def).not.toContain('<script>')
    expect(def).not.toContain('</script>')
    expect(def).not.toContain('alert(1)')
    expect(def).toBe('Normal text.')
  })

  it('Wiktionary: strips inline style blocks rather than rendering their CSS', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Verb',
            definitions: [
              {
                definition: 'Used to express evaluations<style>.mw-parser-output .deprecated{color:olivedrab}</style> [with complement].',
                examples: [],
              },
            ],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('fare', 'fr')

    expect(result!.entries[0]!.definitions[0]!.definition).toBe('Used to express evaluations [with complement].')
  })

  it('Wiktionary: collapses newlines and runs of whitespace inside a definition', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A greeting\n\n  used   daily.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')

    expect(result!.entries[0]!.definitions[0]!.definition).toBe('A greeting used daily.')
  })

  it('Wiktionary: handles partial/unclosed HTML tags that old regex could not strip', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: '<script src="evil.js"', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    // DOMParser parses the partial tag as an HTML element - textContent is empty, so the
    // definition is skipped and there are no entries.
    expect(result).toBeNull()
  })

  it('Wiktionary: trims whitespace-only definitions after stripping', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [
              { definition: '<span>   </span>', examples: [] },
              { definition: 'Valid.', examples: [] },
            ],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    expect(result!.entries[0]!.definitions).toHaveLength(1)
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('Valid.')
  })

  it('Wiktionary: strips HTML from example text', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse('fr')))
    const { lookup } = await load()
    // Use non-English lang to hit Wiktionary directly (avoiding FreeDictionary fallback complexity)
    const result = await lookup('hello', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBe('Hello there.')
  })

  it('Wiktionary: handles string example (not object)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A greeting.', examples: ['<b>Hi</b> there.'] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBe('Hi there.')
  })

  it('Wiktionary: example is null when examples array is empty', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A greeting.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  it('Wiktionary: skips entries with empty definitions after stripping', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [
              { definition: '<span></span>', examples: [] },
              { definition: 'Valid definition.', examples: [] },
            ],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    expect(result!.entries[0]!.definitions).toHaveLength(1)
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('Valid definition.')
  })

  it('Wiktionary: treats non-array examples field as no examples', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A greeting.', examples: 'not an array' }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  it('Wiktionary: skips example object that has no string text field', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A greeting.', examples: [{ text: 42 }, { text: null }] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  it('Wiktionary: returns null when response body is not an object', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null } as unknown as Response)
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result).toBeNull()
  })

  it('Wiktionary: skips entries that are not objects', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [null, 'string-entry', { partOfSpeech: 'Noun', definitions: [{ definition: 'Valid.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries).toHaveLength(1)
  })

  it('Wiktionary: treats non-array definitions field as no definitions (entry skipped)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [{ partOfSpeech: 'Noun', definitions: 'not-an-array' }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result).toBeNull()
  })

  it('Wiktionary: skips definition objects where definition field is not a string', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        fr: [
          {
            partOfSpeech: 'Noun',
            definitions: [
              { definition: 42, examples: [] },
              { definition: 'Valid.', examples: [] },
            ],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions).toHaveLength(1)
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('Valid.')
  })

  // -------------------------------------------------------------------------
  // Language normalization
  // -------------------------------------------------------------------------

  it('lang normalization: en-US routes to Free Dictionary', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en-US')
    expect(result!.provider).toBe('free-dictionary')
    expect(fetchMock.mock.calls[0]![0]).toContain('api.dictionaryapi.dev')
  })

  it('lang normalization: fr-FR routes directly to Wiktionary', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse('fr')))
    const { lookup } = await load()
    await lookup('bonjour', 'fr-FR')
    expect(fetchMock.mock.calls[0]![0]).toContain('fr.wiktionary.org')
  })

  it('lang normalization: empty string defaults to English (Free Dictionary)', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', '')
    expect(result!.provider).toBe('free-dictionary')
  })

  it('lang normalization: English language name maps to en', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'English')
    expect(result!.provider).toBe('free-dictionary')
    expect(fetchMock.mock.calls[0]![0]).toContain('api.dictionaryapi.dev')
  })

  it('lang normalization: ISO-639-2 eng maps to en', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'eng')
    expect(result!.provider).toBe('free-dictionary')
    expect(fetchMock.mock.calls[0]![0]).toContain('api.dictionaryapi.dev')
  })

  it('lang normalization: unknown long language labels fall back to en', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404)).mockResolvedValueOnce(mockOk(makeWiktionaryResponse('en')))
    const { lookup } = await load()
    const result = await lookup('hello', 'some-unknown-language')
    expect(result!.provider).toBe('wiktionary')
    expect(fetchMock.mock.calls[1]![0]).toContain('en.wiktionary.org')
  })

  // -------------------------------------------------------------------------
  // Word trimming
  // -------------------------------------------------------------------------

  it('trims whitespace from the word before lookup', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    await lookup('  hello  ', 'en')
    const calledUrl = fetchMock.mock.calls[0]![0] as string
    expect(calledUrl).toContain('/hello')
    expect(calledUrl).not.toContain('%20')
  })
})
