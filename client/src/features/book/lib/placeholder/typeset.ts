// Typesetting for generated placeholder covers. Titles are measured with the real webfonts and
// broken into balanced lines at a continuous size, so a 3-letter title and an 80-letter one both
// fill their box instead of falling into fixed size buckets.

export interface TextStyle {
  family: string
  weight: number
  tracking?: number
  upper?: boolean
  italic?: boolean
}

export interface LineFit {
  text: string
  size: number
  width: number
  cap: number
  truncated: boolean
}

export interface BlockFit {
  lines: string[]
  /** Unit widths (at font-size 1) of each line. */
  widths: number[]
  size: number
  L: number
  step: number
  cap: number
  desc: number
  /** From the first line's cap top to the last line's baseline. */
  height: number
  width: number
  truncated: boolean
}

export type Fit = LineFit | BlockFit

export interface FitOptions {
  min: number
  max: number
  maxLines?: number
  leading?: number
  align?: 'center' | 'start'
  linePenalty?: number
  hyphenated?: boolean
  soft?: boolean
}

export interface PlaceholderStrings {
  untitled: string
  volume: (number: string) => string
  family: (key: string) => string
  list: Intl.ListFormat
}

export interface PlaceholderInput {
  /** `''` draws the artwork alone; `null` falls back to the untitled label. */
  title: string | null
  subtitle?: string | null
  authors?: readonly string[] | null
  /** A preformatted credit, used only when the author list is unknown. */
  credit?: string | null
  seriesName?: string | null
  seriesIndex?: string | number | null
  genres?: readonly string[] | null
  seed: string
}

export type Script = 'latin' | 'rtl' | 'cjk'

export interface ParsedBook {
  main: string
  subtitle: string | null
  kicker: string | null
  series: { name: string; index: string | null } | null
  volume: string | null
  authors: string[]
  credit: string | null
  bare: boolean
  script: Script
}

export const SMALL_WORDS = new Set(
  'a an the of and or nor but to in on for with by at from as into onto via vs is de la le les el los las du des der die das und von y e o di da del'.split(
    ' ',
  ),
)

const SUFFIX = /^(jr|sr|ii|iii|iv|v|phd|md|esq)\.?$/i
const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const DASH_SPLIT = /^(.{3,}?)\s+\p{Pd}\s+(.{3,})$/u
const NUMBERED = /^(.+?)\s+0*(\d{1,3}(?:\.\d+)?)\s*(?::\s+|\s+\p{Pd}\s+|-(?=\p{Lu}))(.+)$/u
const BARE_VOLUME = /^(vol(?:ume)?\.?|book|issue|part|no\.?|#)\s*0*(\d+(?:\.\d+)?)$/i
const KICKER = /(novel|novella|thriller|romance|mystery|story|stories|memoir|fantasy|comedy|tale)$/i
const NO_BREAK_AFTER = /^(no\.|vol\.|st\.|dr\.|mr\.|mrs\.|ms\.|#)$/i
const KINSOKU_START = /^[、。，．・：；？！ー）」』】〕〉》ゝゞヽヾ々]/
const ELLIPSIS = '…'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const words = (s: string) => s.split(/\s+/).filter(Boolean)
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function scriptOf(text: string): Script {
  if (RTL.test(text)) return 'rtl'
  if (CJK.test(text)) return 'cjk'
  return 'latin'
}

function normalizeIndex(v: string | number | null | undefined): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const n = Number(s)
  return Number.isFinite(n) ? String(n) : s
}

function titleCaseIfShouting(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '')
  if (letters.length < 6 || letters !== letters.toUpperCase()) return s
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

function cleanSeriesName(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.trim().replace(/\s+series$/i, '')
  if (!t || /^\d+$/.test(t)) return null
  return t
}

function seriesHint(s: string): { name: string | null; index: string | null } | null {
  const m = /^(.+?)\s*(?:series|saga|trilogy|chronicles|cycle|sequence)?,?\s*(?:book|bk\.?|vol\.?|volume|#|no\.?|part)\s*#?0*(\d+(?:\.\d+)?)$/i.exec(
    s,
  )
  if (m) return { name: cleanSeriesName(m[1]), index: normalizeIndex(m[2]) }
  if (/\b(series|saga|trilogy|chronicles|family|cycle|quartet|sequence)$/i.test(s)) return { name: cleanSeriesName(s), index: null }
  return null
}

function takeParenthetical(s: string): [string, string | null] {
  const m = /\s*\(([^()]+)\)\s*$/.exec(s)
  if (!m || m.index === 0 || !m[1]) return [s, null]
  return [s.slice(0, m.index).trim(), m[1].trim()]
}

function restatesSeries(sub: string, seriesName: string | null): boolean {
  if (/^(book|vol\.?|volume|part|no\.?|#)\s*#?\d+(\.\d+)?$/i.test(sub)) return true
  if (!seriesName) return false
  const rest = norm(sub).replace(norm(seriesName), '').trim()
  return norm(sub).includes(norm(seriesName)) && /^(book|vol|volume|part|no)?\s*\d*$/.test(rest)
}

/** "Moore, Stephen L." reads "Stephen L. Moore"; a trailing catalogue number is dropped. */
export function cleanAuthor(raw: string): string {
  let s = raw.trim().replace(/\s*\(\d+\)$/, '')
  const m = /^([^,]+),\s*([^,]+)$/.exec(s)
  if (m && m[1] && m[2] && !SUFFIX.test(m[2].trim())) s = `${m[2].trim()} ${m[1].trim()}`
  return s.replace(/\s+/g, ' ')
}

export function splitAuthors(list: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  for (const a of list ?? []) {
    if (!a) continue
    if ((a.match(/,/g) ?? []).length >= 2 || /,\s*and\s+/i.test(a)) out.push(...a.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i))
    else out.push(a)
  }
  return out.map(cleanAuthor).filter(Boolean)
}

/** Ordered credit lines for the book, longest first, each shorter fallback losing names. */
export function authorCandidates(p: ParsedBook, list: Intl.ListFormat): string[] {
  const names = p.authors
  const n = names.length
  if (n === 0) return p.credit ? [p.credit] : []
  const [first = '', second = ''] = names
  if (n === 1) return [first]
  if (n === 2) return [list.format(names), `${first} +1`]
  if (n === 3) return [list.format(names), `${list.format([first, second])} +1`, `${first} +2`]
  return [`${list.format([first, second])} +${n - 2}`, `${first} +${n - 1}`]
}

export function parseBook(input: PlaceholderInput, strings: PlaceholderStrings): ParsedBook {
  const bare = input.title === ''
  let main = (input.title ?? '').replace(/\s+/g, ' ').trim()
  if (!main) main = strings.untitled
  let seriesName = cleanSeriesName(input.seriesName)
  let seriesIndex = normalizeIndex(input.seriesIndex)
  let sub = (input.subtitle ?? '').replace(/\s+/g, ' ').trim() || null
  let volume: string | null = null

  const [withoutParen, paren] = takeParenthetical(main)
  main = withoutParen
  if (paren) {
    const hint = seriesHint(paren)
    if (hint?.name) {
      seriesName ??= hint.name
      seriesIndex ??= hint.index
    }
  }

  const numbered = NUMBERED.exec(main)
  if (numbered?.[1] && numbered[2] && numbered[3]) {
    const head = numbered[1]
    if (words(head).length >= 2 || (seriesName && norm(head) === norm(seriesName))) {
      seriesName ??= cleanSeriesName(head)
      seriesIndex ??= normalizeIndex(numbered[2])
      main = numbered[3].trim()
    }
  }

  if (seriesName) {
    const restated = new RegExp(
      `^${escapeRegExp(seriesName)}[\\s,:#-]*(?:(?:vol(?:ume)?|book|no|issue|part)\\.?\\s*)?#?0*(\\d+(?:\\.\\d+)?)$`,
      'i',
    ).exec(main)
    if (restated?.[1]) {
      volume = normalizeIndex(restated[1])
      seriesIndex ??= volume
      main = seriesName
    }
  }
  const bareVolume = BARE_VOLUME.exec(main)
  if (bareVolume?.[2] && seriesName) {
    volume = normalizeIndex(bareVolume[2])
    main = seriesName
  }

  let embedded: string | null = null
  const parts = main.split(/:\s+/)
  if (parts.length > 1) {
    let k = 1
    while (k < parts.length && words(parts.slice(0, k).join(': ')).length < 2) k++
    if (k < parts.length) {
      embedded = parts.slice(k).join(': ')
      main = parts.slice(0, k).join(': ')
    }
  }
  if (!embedded) {
    const dashed = DASH_SPLIT.exec(main)
    if (dashed?.[1] && dashed[2]) {
      main = dashed[1]
      embedded = dashed[2]
    }
  }
  if (embedded) {
    embedded = titleCaseIfShouting(embedded)
    const hint = seriesHint(embedded)
    if (hint?.name && !hint.index) {
      seriesName ??= hint.name
      embedded = null
    }
  }

  if (sub) {
    const [rest, subParen] = takeParenthetical(sub)
    if (subParen) {
      const hint = seriesHint(subParen)
      if (hint?.name) {
        seriesName ??= hint.name
        seriesIndex ??= hint.index
      }
    }
    sub = rest || null
  }
  if (sub && (restatesSeries(sub, seriesName) || /^\(.*\)$/.test(sub))) sub = null
  if (embedded && sub && (norm(embedded) === norm(sub) || norm(sub).includes(norm(embedded)))) sub = null

  let subtitle = embedded ?? sub
  let kicker: string | null = null
  if (subtitle && /^(a|an)\s/i.test(subtitle) && words(subtitle).length <= 5 && KICKER.test(subtitle)) {
    kicker = subtitle
    subtitle = null
  }
  if (subtitle && subtitle.length > 58) subtitle = null

  main = titleCaseIfShouting(main)
  const series = seriesName && norm(seriesName) !== norm(main) ? { name: seriesName, index: seriesIndex } : null
  if (!series && seriesName && seriesIndex && !volume) volume = seriesIndex

  const authors = splitAuthors(input.authors)
  return {
    main,
    subtitle,
    kicker,
    series,
    volume,
    authors,
    credit: authors.length ? null : input.credit?.trim() || null,
    bare,
    script: scriptOf(main),
  }
}

// ---------------------------------------------------------------- measurement

let context: CanvasRenderingContext2D | null | undefined
const widthCache = new Map<string, number>()
const metricCache = new Map<string, { cap: number; desc: number }>()

function measureContext(): CanvasRenderingContext2D | null {
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  return context
}

/** Called when webfonts finish loading, since widths measured against a fallback face are wrong. */
export function clearMeasureCache(): void {
  widthCache.clear()
  metricCache.clear()
}

const fontString = (st: TextStyle) => `${st.italic ? 'italic ' : ''}${st.weight} 100px ${st.family}`
const fontKey = (st: TextStyle) => `${fontString(st)}|${st.tracking ?? 0}|${st.upper ? 1 : 0}`

export function applyCase(text: string, st: TextStyle): string {
  return st.upper ? text.toLocaleUpperCase() : text
}

/** Advance width of `text` at font-size 1. */
export function measure(text: string, st: TextStyle): number {
  const key = `${fontKey(st)}\u0000${text}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached
  const ctx = measureContext()
  let width: number
  if (ctx) {
    ctx.font = fontString(st)
    ctx.letterSpacing = `${(st.tracking ?? 0) * 100}px`
    // canvas counts tracking after the last glyph, which is not ink
    width = ctx.measureText(applyCase(text, st)).width / 100 - Math.max(0, st.tracking ?? 0)
  } else {
    width = [...applyCase(text, st)].length * (0.56 + (st.tracking ?? 0))
  }
  widthCache.set(key, width)
  return width
}

export function metrics(st: TextStyle): { cap: number; desc: number } {
  const key = fontKey(st)
  const cached = metricCache.get(key)
  if (cached) return cached
  const ctx = measureContext()
  let m = { cap: 0.72, desc: 0.22 }
  if (ctx) {
    ctx.font = fontString(st)
    ctx.letterSpacing = '0px'
    const cap = ctx.measureText('H').actualBoundingBoxAscent / 100
    const desc = ctx.measureText('gjpqy').actualBoundingBoxDescent / 100
    if (cap > 0) m = { cap, desc }
  }
  metricCache.set(key, m)
  return m
}

// ---------------------------------------------------------------- line breaking

interface Token {
  t: string
  sp: boolean
}

function tokenize(text: string, script: Script): Token[] {
  if (script === 'cjk') return [...text].map((t) => ({ t, sp: false }))
  return words(text).map((t) => ({ t, sp: true }))
}

function join(tokens: Token[]): string {
  let s = ''
  tokens.forEach((token, i) => {
    s += token.t + (i < tokens.length - 1 && token.sp ? ' ' : '')
  })
  return s
}

function* partitions(n: number, L: number, start = 0): Generator<number[]> {
  if (L === 1) {
    yield [n]
    return
  }
  for (let cut = start + 1; cut <= n - (L - 1); cut++) for (const rest of partitions(n, L - 1, cut)) yield [cut, ...rest]
}

interface Candidate {
  score: number
  size: number
  lines: string[]
  widths: number[]
  L: number
}

/**
 * The best multi-line layout for `text` inside `box`: every line count is tried, and layouts lose
 * points for ragged lines, a line ending on "of" or "the", a lone short last word, and a one-letter
 * line. Only when nothing fits does it dip under the floor, hyphenate a very long word, or truncate.
 */
export function fitBlock(text: string, st: TextStyle, box: { w: number; h: number }, options: FitOptions): BlockFit {
  const opts = options.min > options.max ? { ...options, max: options.min } : options
  const script = scriptOf(text)
  const tokens = tokenize(text, script)
  const n = Math.max(1, tokens.length)
  const m = metrics(st)
  const lead = opts.leading ?? 1.1
  const maxL = Math.min(opts.maxLines ?? 5, n)
  const center = opts.align === 'center'
  let best: Candidate | null = null

  const consider = (lines: string[], L: number) => {
    const widths = lines.map((l) => measure(l, st))
    const maxW = Math.max(...widths, 1e-6)
    const heightSize = box.h / (m.cap + (L - 1) * lead + m.desc * 0.6)
    const size = Math.min(opts.max, box.w / maxW, heightSize)
    if (size < opts.min) return
    let pen = 0
    for (let i = 0; i < L - 1; i++) {
      const last =
        words(lines[i] ?? '')
          .at(-1)
          ?.toLowerCase() ?? ''
      if (/^(a|an|the)$/.test(last)) pen += 0.2
      else if (SMALL_WORDS.has(last)) pen += 0.11
      if (NO_BREAK_AFTER.test(last)) pen += 0.3
      if (script === 'cjk' && KINSOKU_START.test(lines[i + 1] ?? '')) pen += 0.5
      if (script !== 'cjk' && (lines[i] ?? '').replace(/[^\p{L}\p{N}]/gu, '').length <= 2) pen += 0.18
    }
    for (let i = 1; i < L - 1; i++) if (words(lines[i] ?? '').every((w) => SMALL_WORDS.has(w.toLowerCase()))) pen += 0.2
    if (L > 1) {
      const lastLine = lines[L - 1] ?? ''
      if (script !== 'cjk' && words(lastLine).length === 1 && lastLine.length <= 4) pen += 0.14
      let rag = 0
      for (const w of widths) rag += ((maxW - w) / maxW) ** 2
      pen += (center ? 0.22 : 0.12) * (rag / L)
      if ((widths[0] ?? 0) < maxW * 0.38) pen += 0.08
    }
    const score = size * (1 - pen) * (1 - (opts.linePenalty ?? 0.05) * (L - 1))
    if (!best || score > best.score) best = { score, size, lines, widths, L }
  }

  for (let L = 1; L <= maxL; L++) {
    if (tokens.length > 18 && L > 1) {
      const per = Math.ceil(tokens.length / L)
      const lines: string[] = []
      for (let i = 0; i < tokens.length; i += per) lines.push(join(tokens.slice(i, i + per)))
      consider(lines, lines.length)
      continue
    }
    for (const cuts of partitions(tokens.length, L)) {
      const lines: string[] = []
      let s = 0
      for (const cut of cuts) {
        lines.push(join(tokens.slice(s, cut)))
        s = cut
      }
      consider(lines, L)
    }
  }

  const longest = tokens.reduce<Token | undefined>((a, t) => (!a || measure(t.t, st) > measure(a.t, st) ? t : a), undefined)
  const found = best as Candidate | null
  if (found) {
    if (script === 'latin' && longest && !opts.hyphenated && longest.t.length >= 14 && found.size < opts.min * 1.5) {
      const alt = fitBlock(text.replace(longest.t, hyphenate(longest.t, st, box.w / (opts.min * 1.5)).join(' ')), st, box, {
        ...opts,
        hyphenated: true,
      })
      if (!alt.truncated && alt.size > found.size * 1.2) return alt
    }
    return finish(found, m, lead, false)
  }
  if (!opts.soft) {
    const soft = fitBlock(text, st, box, { ...opts, min: opts.min * 0.84, soft: true, hyphenated: true })
    if (!soft.truncated) return soft
  }
  if (script === 'latin' && longest && !opts.hyphenated && longest.t.length >= 13 && measure(longest.t, st) * opts.min > box.w) {
    return fitBlock(text.replace(longest.t, hyphenate(longest.t, st, box.w / opts.min).join(' ')), st, box, { ...opts, hyphenated: true })
  }
  return truncateBlock(tokens, st, box, opts, m, lead)
}

function hyphenate(word: string, st: TextStyle, maxW: number): string[] {
  const out: string[] = []
  let rest = word
  while (measure(rest, st) > maxW && rest.length > 6) {
    let cut = rest.length - 3
    while (cut > 3 && measure(`${rest.slice(0, cut)}-`, st) > maxW) cut--
    for (let d = 0; d <= 2; d++) {
      const c = cut - d
      if (/[aeiouy]/i.test(rest[c - 1] ?? '') && /[^aeiouy]/i.test(rest[c] ?? '')) {
        cut = c
        break
      }
    }
    out.push(`${rest.slice(0, cut)}-`)
    rest = rest.slice(cut)
  }
  out.push(rest)
  return out
}

function truncateBlock(
  tokens: Token[],
  st: TextStyle,
  box: { w: number; h: number },
  opts: FitOptions,
  m: { cap: number; desc: number },
  lead: number,
): BlockFit {
  const size = opts.min
  const maxW = box.w / size
  const maxL = Math.max(1, Math.min(opts.maxLines ?? 5, Math.floor((box.h / size - m.cap - m.desc * 0.6) / lead) + 1))
  const groups: Token[][] = []
  let cur: Token[] = []
  for (const t of tokens) {
    if (cur.length && measure(join([...cur, t]), st) > maxW) {
      groups.push(cur)
      cur = [t]
    } else cur.push(t)
  }
  if (cur.length) groups.push(cur)
  const lines = groups.slice(0, maxL).map(join)
  if (groups.length > maxL) {
    let last = lines[maxL - 1] ?? ''
    while (last.length > 1 && measure(last + ELLIPSIS, st) > maxW) last = last.slice(0, -1).trimEnd()
    lines[maxL - 1] = last.replace(/[\s,:;.-]+$/, '') + ELLIPSIS
  }
  const fitted = lines.map((l) => {
    let s = l
    while (s.length > 1 && measure(s, st) > maxW) s = s.slice(0, -2) + ELLIPSIS
    return s
  })
  return finish({ score: 0, size, lines: fitted, widths: fitted.map((l) => measure(l, st)), L: fitted.length }, m, lead, true)
}

function finish(r: Candidate, m: { cap: number; desc: number }, lead: number, truncated: boolean): BlockFit {
  const step = r.size * lead
  return {
    lines: r.lines,
    widths: r.widths,
    size: r.size,
    L: r.L,
    step,
    cap: m.cap * r.size,
    desc: m.desc * r.size,
    height: m.cap * r.size + (r.L - 1) * step,
    width: Math.max(...r.widths) * r.size,
    truncated,
  }
}

/** One line: the largest size in [min, max] that fits, walking through shorter fallbacks before truncating. */
export function fitLine(candidates: readonly string[], st: TextStyle, w: number, options: FitOptions): LineFit | null {
  const list = candidates.filter(Boolean)
  if (!list.length) return null
  const opts = options.min > options.max ? { ...options, max: options.min } : options
  const cap = metrics(st).cap
  for (const text of list) {
    const size = Math.min(opts.max, w / measure(text, st))
    if (size >= opts.min) return { text, size, width: measure(text, st) * size, cap: cap * size, truncated: false }
  }
  let text = list.at(-1) ?? ''
  const maxW = w / opts.min
  while (text.length > 1 && measure(text + ELLIPSIS, st) > maxW) text = text.slice(0, -1).trimEnd()
  text = text.replace(/[\s,&+]+$/, '') + ELLIPSIS
  return { text, size: opts.min, width: measure(text, st) * opts.min, cap: cap * opts.min, truncated: true }
}

/** A credit that may wrap to `maxLines` before falling back to the shorter "+N" forms. */
export function fitAuthors(p: ParsedBook, list: Intl.ListFormat, st: TextStyle, w: number, opts: FitOptions, maxLines = 2): Fit | null {
  const candidates = authorCandidates(p, list)
  const first = candidates[0]
  if (!first) return null
  const one = fitLine(candidates, st, w, opts)
  if (one && !one.truncated && one.text === first) return one
  if (maxLines > 1 && p.authors.length >= 1 && p.authors.length <= 3) {
    const block = fitBlock(
      list.format(p.authors),
      st,
      { w, h: opts.max * 4 },
      { min: opts.min, max: opts.max, maxLines, leading: 1.3, align: 'center', linePenalty: 0.2 },
    )
    if (!block.truncated && block.L <= maxLines && block.size >= (one?.size ?? 0) * 0.9) return block
  }
  return one
}

export const fitHeight = (fit: Fit): number => ('height' in fit ? fit.height : fit.cap)

// ---------------------------------------------------------------- seeded randomness

export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export type Random = () => number

export function rng(seed: number): Random {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(r: Random, list: readonly T[]): T {
  return list[Math.floor(r() * list.length) % list.length] as T
}

/** First letter of the first significant word, for tiles too small to hold a title. */
export function monogram(p: ParsedBook): string {
  const ws = words(p.main)
  const sig = ws.find((w, i) => !(i === 0 && /^(the|a|an)$/i.test(w) && ws.length > 1)) ?? ws[0] ?? '?'
  return ([...sig.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '?').toLocaleUpperCase()
}

export const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
