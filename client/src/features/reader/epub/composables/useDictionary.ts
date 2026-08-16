import type { DictionaryDefinition, DictionaryEntry, DictionaryResult } from '@bookorbit/types'

const LANGUAGE_ALIASES: Record<string, string> = {
  ar: 'ar',
  ara: 'ar',
  arabic: 'ar',
  cs: 'cs',
  ces: 'cs',
  cze: 'cs',
  czech: 'cs',
  da: 'da',
  dan: 'da',
  danish: 'da',
  de: 'de',
  deu: 'de',
  ger: 'de',
  german: 'de',
  el: 'el',
  ell: 'el',
  gre: 'el',
  greek: 'el',
  en: 'en',
  eng: 'en',
  english: 'en',
  es: 'es',
  spa: 'es',
  spanish: 'es',
  fi: 'fi',
  fin: 'fi',
  finnish: 'fi',
  fr: 'fr',
  fra: 'fr',
  fre: 'fr',
  french: 'fr',
  he: 'he',
  heb: 'he',
  hebrew: 'he',
  hi: 'hi',
  hin: 'hi',
  hindi: 'hi',
  hu: 'hu',
  hun: 'hu',
  hungarian: 'hu',
  id: 'id',
  ind: 'id',
  indonesian: 'id',
  it: 'it',
  ita: 'it',
  italian: 'it',
  ja: 'ja',
  jpn: 'ja',
  japanese: 'ja',
  ko: 'ko',
  kor: 'ko',
  korean: 'ko',
  nl: 'nl',
  nld: 'nl',
  dut: 'nl',
  dutch: 'nl',
  no: 'no',
  nor: 'no',
  norwegian: 'no',
  pl: 'pl',
  pol: 'pl',
  polish: 'pl',
  pt: 'pt',
  por: 'pt',
  portuguese: 'pt',
  ro: 'ro',
  ron: 'ro',
  rum: 'ro',
  romanian: 'ro',
  ru: 'ru',
  rus: 'ru',
  russian: 'ru',
  sv: 'sv',
  swe: 'sv',
  swedish: 'sv',
  th: 'th',
  tha: 'th',
  thai: 'th',
  tr: 'tr',
  tur: 'tr',
  turkish: 'tr',
  uk: 'uk',
  ukr: 'uk',
  ukrainian: 'uk',
  vi: 'vi',
  vie: 'vi',
  vietnamese: 'vi',
  zh: 'zh',
  zho: 'zh',
  chi: 'zh',
  chinese: 'zh',
}

const MAX_DEFINITIONS_PER_ENTRY = 5
const MAX_LEMMA_DEPTH = 2
const MAX_LEMMA_LOOKUPS = 3

/**
 * Words allowed before "of" in an inflection gloss such as "simple past and
 * past participle of walk". Requiring every leading word to be grammatical is
 * what keeps ordinary definitions ("Informal form of address used by...") from
 * being mistaken for pointers.
 */
const GRAMMAR_TERMS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'ablative',
  'abbreviation',
  'accusative',
  'acronym',
  'active',
  'adjective',
  'adverb',
  'alternate',
  'alternative',
  'aorist',
  'archaic',
  'attributive',
  'augmentative',
  'capitalized',
  'clipping',
  'common',
  'comparative',
  'conditional',
  'conjugation',
  'construct',
  'contraction',
  'dated',
  'dative',
  'declension',
  'definite',
  'diminutive',
  'dual',
  'elative',
  'essive',
  'feminine',
  'first-person',
  'form',
  'forms',
  'future',
  'genitive',
  'gerund',
  'illative',
  'imperative',
  'imperfect',
  'imperfective',
  'indefinite',
  'indicative',
  'infinitive',
  'inflected',
  'inflection',
  'inflections',
  'initialism',
  'instrumental',
  'letter-case',
  'locative',
  'lowercase',
  'masculine',
  'misspelling',
  'neuter',
  'nominative',
  'nonstandard',
  'noun',
  'obsolete',
  'participle',
  'particle',
  'partitive',
  'passive',
  'past',
  'perfect',
  'perfective',
  'pluperfect',
  'plural',
  'positive',
  'prepositional',
  'present',
  'preterite',
  'second-person',
  'simple',
  'singular',
  'spelling',
  'substantive',
  'superlative',
  'supine',
  'tense',
  'third-person',
  'uppercase',
  'verb',
  'verbal',
  'vocative',
])

const FILLER_TERMS = new Set(['a', 'an', 'the', 'and', 'or'])

const POINTER_PATTERN = /^(?:\([^)]*\)\s*)?([\p{L}\p{M}/ -]+?)\s+of\s+([\p{L}\p{M}][\p{L}\p{M}'’-]*)\s*[.:;,]?$/u

interface SenseBlock {
  partOfSpeech: string
  definitions: DictionaryDefinition[]
}

type BlockFetcher = (word: string) => Promise<SenseBlock[]>

/**
 * Returns the lemma a definition merely points at, or null when the definition
 * stands on its own. "plural of candelabra" tells the reader nothing, so the
 * lookup follows it; "A candle holder." is an answer, so it does not.
 */
function pointerLemma(definition: string): string | null {
  const match = POINTER_PATTERN.exec(definition.trim())
  if (!match) return null

  const modifiers = (match[1] ?? '')
    .toLowerCase()
    .split(/[\s/]+/)
    .filter(Boolean)
  if (modifiers.length === 0) return null
  if (!modifiers.every((term) => GRAMMAR_TERMS.has(term))) return null
  if (modifiers.every((term) => FILLER_TERMS.has(term))) return null

  return (match[2] ?? '').toLowerCase()
}

function stripHtml(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  // textContent includes the text inside script and style elements, and
  // Wiktionary ships inline <style> blocks with some senses, so their CSS would
  // otherwise be rendered as part of the definition.
  for (const el of body.querySelectorAll('script, style')) el.remove()
  return (body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeLang(lang: string): string {
  if (!lang) return 'en'
  const normalized = lang.trim().toLowerCase()
  if (!normalized) return 'en'

  const primary = normalized.split(/[;,/|]/)[0]?.trim() ?? ''
  if (!primary) return 'en'

  const base = primary.split('-')[0]?.trim() ?? ''
  const alias = LANGUAGE_ALIASES[base]
  if (alias) return alias

  if (/^[a-z]{2,3}$/.test(base)) return base

  return 'en'
}

function extractPhonetics(entry: Record<string, unknown>): { phonetic: string | null; audioUrl: string | null } {
  let phonetic = (entry['phonetic'] as string | undefined) ?? null
  let audioUrl: string | null = null

  const phonetics = entry['phonetics'] as Array<Record<string, unknown>> | undefined
  if (Array.isArray(phonetics)) {
    for (const p of phonetics) {
      const audio = typeof p['audio'] === 'string' ? p['audio'] : null
      const text = typeof p['text'] === 'string' && p['text'] ? p['text'] : null
      if (audio) {
        audioUrl = audio
        if (text) phonetic = text
        break
      }
      if (!phonetic && text) {
        phonetic = text
      }
    }
  }

  return { phonetic, audioUrl }
}

function parseMeanings(meanings: Array<Record<string, unknown>>): SenseBlock[] {
  return meanings.map((m) => {
    const partOfSpeech = typeof m['partOfSpeech'] === 'string' ? m['partOfSpeech'] : ''
    const rawDefs = Array.isArray(m['definitions']) ? (m['definitions'] as Array<Record<string, unknown>>) : []
    const definitions: DictionaryDefinition[] = rawDefs.map((d) => ({
      definition: typeof d['definition'] === 'string' ? d['definition'] : '',
      example: typeof d['example'] === 'string' ? d['example'] : null,
    }))
    return { partOfSpeech, definitions }
  })
}

/**
 * Collapses blocks that share a part of speech. Both providers split a word
 * across several same-part-of-speech blocks (one per etymology), which would
 * otherwise render as repeated "NOUN" headings and hide whether a pointer is
 * the leading sense.
 */
function mergeBlocks(blocks: SenseBlock[]): SenseBlock[] {
  const merged: SenseBlock[] = []
  const byPartOfSpeech = new Map<string, SenseBlock>()

  for (const block of blocks) {
    if (block.definitions.length === 0) continue
    const existing = byPartOfSpeech.get(block.partOfSpeech)
    if (existing) {
      existing.definitions.push(...block.definitions)
      continue
    }
    const copy: SenseBlock = { partOfSpeech: block.partOfSpeech, definitions: [...block.definitions] }
    byPartOfSpeech.set(block.partOfSpeech, copy)
    merged.push(copy)
  }

  return merged
}

interface ProviderPayload {
  word: string
  phonetic: string | null
  audioUrl: string | null
  blocks: SenseBlock[]
}

async function fetchFreeDictionaryPayload(word: string): Promise<ProviderPayload | null> {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Free Dictionary API error: ${res.status}`)

  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null

  const entry = data[0] as Record<string, unknown>
  const { phonetic, audioUrl } = extractPhonetics(entry)
  const meanings = Array.isArray(entry['meanings']) ? (entry['meanings'] as Array<Record<string, unknown>>) : []
  const blocks = mergeBlocks(parseMeanings(meanings))

  if (blocks.length === 0) return null

  return {
    word: typeof entry['word'] === 'string' ? entry['word'] : word,
    phonetic,
    audioUrl,
    blocks,
  }
}

function parseWiktionaryBlocks(data: Record<string, unknown>, lang: string): SenseBlock[] {
  const blocks: SenseBlock[] = []

  // Wiktionary keys its response by language and a single page carries every
  // language that spells the word the same way, so only the requested section
  // is ours. Reading them all mixed Latin and Faroese into English lookups.
  const langEntries = data[lang]
  if (!Array.isArray(langEntries)) return blocks

  for (const entry of langEntries) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const partOfSpeech = typeof e['partOfSpeech'] === 'string' ? e['partOfSpeech'] : ''
    const rawDefs = Array.isArray(e['definitions']) ? (e['definitions'] as Array<Record<string, unknown>>) : []
    const definitions: DictionaryDefinition[] = []

    for (const d of rawDefs) {
      const def = typeof d['definition'] === 'string' ? stripHtml(d['definition']) : ''
      if (!def) continue
      const rawExamples = Array.isArray(d['examples']) ? (d['examples'] as unknown[]) : []
      let example: string | null = null
      for (const ex of rawExamples) {
        if (typeof ex === 'string') {
          example = stripHtml(ex)
          break
        } else if (ex && typeof ex === 'object') {
          const t = (ex as Record<string, unknown>)['text']
          if (typeof t === 'string') {
            example = stripHtml(t)
            break
          }
        }
      }
      definitions.push({ definition: def, example })
    }

    if (definitions.length > 0) {
      blocks.push({ partOfSpeech, definitions })
    }
  }

  return blocks
}

async function fetchWiktionaryPayload(word: string, lang: string): Promise<ProviderPayload | null> {
  const res = await fetch(`https://${encodeURIComponent(lang)}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Wiktionary API error: ${res.status}`)

  const data: unknown = await res.json()
  if (!data || typeof data !== 'object') return null

  const blocks = mergeBlocks(parseWiktionaryBlocks(data as Record<string, unknown>, lang))
  if (blocks.length === 0) return null

  return { word, phonetic: null, audioUrl: null, blocks }
}

/**
 * Walks inflection pointers breadth-first so a lookup that lands on a pure
 * inflection ("candelabras" -> "candelabra" -> "candelabrum") still reaches a
 * word that carries a real definition. Only a pointer in the leading sense of
 * its block is followed: a pointer buried at sense 69 of "run" is trivia, not
 * the answer the reader is missing.
 */
async function expandPointers(root: ProviderPayload, fetchBlocks: BlockFetcher): Promise<DictionaryEntry[]> {
  const entries: DictionaryEntry[] = []
  const visited = new Set<string>([root.word.toLowerCase()])
  const queue: Array<{ word: string; blocks: SenseBlock[]; depth: number }> = [{ word: root.word, blocks: root.blocks, depth: 0 }]
  let lookups = 0

  while (queue.length > 0) {
    const current = queue.shift()!

    for (const block of current.blocks) {
      entries.push({
        partOfSpeech: block.partOfSpeech,
        definitions: block.definitions.slice(0, MAX_DEFINITIONS_PER_ENTRY),
        sourceWord: current.word,
      })
    }

    if (current.depth >= MAX_LEMMA_DEPTH) continue

    for (const block of current.blocks) {
      if (lookups >= MAX_LEMMA_LOOKUPS) break

      const leading = block.definitions[0]
      if (!leading) continue
      const lemma = pointerLemma(leading.definition)
      if (!lemma || visited.has(lemma)) continue

      visited.add(lemma)
      lookups += 1

      let blocks: SenseBlock[] = []
      try {
        blocks = mergeBlocks(await fetchBlocks(lemma))
      } catch {
        // A lemma that fails to resolve must never take the primary result down
        continue
      }
      if (blocks.length > 0) queue.push({ word: lemma, blocks, depth: current.depth + 1 })
    }
  }

  return entries
}

export function useDictionary() {
  async function lookup(word: string, lang: string): Promise<DictionaryResult | null> {
    const normalizedLang = normalizeLang(lang)
    const trimmed = word.trim()

    if (normalizedLang === 'en') {
      let payload: ProviderPayload | null = null
      try {
        payload = await fetchFreeDictionaryPayload(trimmed)
      } catch {
        // Fall back to Wiktionary on any Free Dictionary error
      }
      if (payload) {
        const entries = await expandPointers(payload, async (lemma) => (await fetchFreeDictionaryPayload(lemma))?.blocks ?? [])
        return { word: payload.word, phonetic: payload.phonetic, audioUrl: payload.audioUrl, entries, provider: 'free-dictionary' }
      }
    }

    const payload = await fetchWiktionaryPayload(trimmed, normalizedLang)
    if (!payload) return null

    const entries = await expandPointers(payload, async (lemma) => (await fetchWiktionaryPayload(lemma, normalizedLang))?.blocks ?? [])
    return { word: payload.word, phonetic: payload.phonetic, audioUrl: payload.audioUrl, entries, provider: 'wiktionary' }
  }

  return { lookup }
}
