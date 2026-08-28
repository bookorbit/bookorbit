import { describe, expect, it } from 'vitest'

import { classifyChange, explainChange, patternSegments } from '../changeKind'
import { diffPath, diffSegment, stripRoot, type DiffOp } from '../pathDiff'

/** Renders a diff as `text[-removed-][+added+]`, which makes the expectations readable. */
function render(ops: DiffOp[]): string {
  return ops.map((op) => (op.kind === 'eq' ? op.value : op.kind === 'del' ? `[-${op.value}-]` : `[+${op.value}+]`)).join('')
}

describe('diffSegment', () => {
  it('marks a single changed capital rather than the whole word', () => {
    expect(render(diffSegment('Craig Dilouie', 'Craig DiLouie'))).toBe('Craig Di[-l-][+L+]ouie')
  })

  it('surfaces a doubled space, which is otherwise an invisible rename', () => {
    expect(render(diffSegment('Helen  Fitzgerald', 'Helen FitzGerald'))).toBe('Helen [- -]Fitz[-g-][+G+]erald')
  })

  it('reads a reordered name as a move, not as scattered characters', () => {
    expect(render(diffSegment('Katie Kitamura', 'Kitamura, Katie'))).toBe('[-Katie -]Kitamura[+, Katie+]')
  })

  it('narrows a corrected year to the digits that changed', () => {
    expect(render(diffSegment('Circus (1983)', 'Circus (1976)'))).toBe('Circus (19[-83-][+76+])')
  })

  it('peels a shared suffix so a removed year is a deletion, not a swap', () => {
    expect(render(diffSegment('Ham on Rye (2007).epub', 'Ham on Rye.epub'))).toBe('Ham on Rye[- (2007)-].epub')
  })

  it('marks a dropped index prefix on its own', () => {
    expect(render(diffSegment('01. Bound by Fate (2023).azw3', 'Bound by Fate (2023).azw3'))).toBe('[-01. -]Bound by Fate (2023).azw3')
  })

  it('marks a replaced unsafe character in place', () => {
    expect(render(diffSegment('Social Engineering: The Art', 'Social Engineering_ The Art'))).toBe('Social Engineering[-:-][+_+] The Art')
  })

  it('marks a dropped multi-part suffix', () => {
    expect(render(diffSegment('01. The Three-Body Problem (2014)-Part02.mp3', '01. The Three-Body Problem (2014).mp3'))).toBe(
      '01. The Three-Body Problem (2014)[--Part02-].mp3',
    )
  })

  it('returns a single equal run when nothing changed', () => {
    expect(diffSegment('Same', 'Same')).toEqual([{ kind: 'eq', value: 'Same' }])
  })

  it('handles an empty side', () => {
    expect(render(diffSegment('', 'New'))).toBe('[+New+]')
    expect(render(diffSegment('Old', ''))).toBe('[-Old-]')
  })
})

describe('diffPath', () => {
  it('drops the empty segment a leading slash produces on an absolute path', () => {
    const rows = diffPath('/srv/books/Dean Koontz/Ticktock.epub', '/srv/books/Dean Koontz/Ticktock (2007).epub')

    expect(rows.map((row) => row.from)).toEqual(['srv', 'books', 'Dean Koontz', 'Ticktock.epub'])
    expect(rows.every((row) => row.from !== '')).toBe(true)
  })

  it('pairs surviving segments when a folder level is dropped', () => {
    const rows = diffPath(
      'Aisling Elizabeth/The Key Stone Pack/01. Bound by Fate (2023)/01. Bound by Fate (2023).azw3',
      'Aisling Elizabeth/Bound by Fate (2023)/Bound by Fate (2023).azw3',
    )

    expect(rows.map((row) => row.kind)).toEqual(['eq', 'del', 'edit', 'edit'])
    expect(rows[1]!.from).toBe('The Key Stone Pack')
    expect(render(rows[2]!.ops!)).toBe('[-01. -]Bound by Fate (2023)')
    expect(render(rows[3]!.ops!)).toBe('[-01. -]Bound by Fate (2023).azw3')
  })

  it('keeps a duplicated folder level as the removal, not the filename', () => {
    const rows = diffPath(
      "Cixin Liu/The Remembrance of Earth's Past/01. TTBP (2014)/01. TTBP (2014)/01. TTBP (2014)-Part02.mp3",
      "Cixin Liu/The Remembrance of Earth's Past/01. TTBP (2014)/01. TTBP (2014).mp3",
    )

    expect(rows.map((row) => row.kind)).toEqual(['eq', 'eq', 'eq', 'del', 'edit'])
    expect(render(rows[4]!.ops!)).toBe('01. TTBP (2014)[--Part02-].mp3')
  })

  it('marks only the segment that changed when depth is unchanged', () => {
    const rows = diffPath('Helen  Fitzgerald/The Exit (2015)/The Exit (2015).epub', 'Helen FitzGerald/The Exit (2015)/The Exit (2015).epub')

    expect(rows.map((row) => row.kind)).toEqual(['edit', 'eq', 'eq'])
  })

  it('reports every segment as equal for an identical path', () => {
    const rows = diffPath('A/B/C.epub', 'A/B/C.epub')
    expect(rows.every((row) => row.kind === 'eq')).toBe(true)
  })

  it('records an added folder level without disturbing the filename', () => {
    const rows = diffPath('Author/Title.epub', 'Author/Title/Title.epub')
    expect(rows.map((row) => row.kind)).toEqual(['eq', 'ins', 'eq'])
    expect(rows[1]!.to).toBe('Title')
  })
})

describe('classifyChange', () => {
  const cases: [string, string, string][] = [
    [
      'Aisling Elizabeth/The Key Stone Pack/01. Bound by Fate (2023)/01. Bound by Fate (2023).azw3',
      'Aisling Elizabeth/Bound by Fate (2023)/Bound by Fate (2023).azw3',
      'ungroup',
    ],
    ['Helen  Fitzgerald/The Exit (2015)/The Exit (2015).epub', 'Helen FitzGerald/The Exit (2015)/The Exit (2015).epub', 'authorSpelling'],
    ['Charles Bukowski/Ham on Rye (2007)/Ham on Rye (2007).epub', 'Charles Bukowski/Ham on Rye/Ham on Rye.epub', 'yearRemoved'],
    ['A/Not Quite Dead Yet/Not Quite Dead Yet.epub', 'A/Not Quite Dead Yet (2025)/Not Quite Dead Yet (2025).epub', 'yearAdded'],
    ['A/Circus (1983)/Circus (1983).fb2', 'A/Circus (1976)/Circus (1976).fb2', 'yearCorrected'],
    ['Author/Title/Title.pdf', 'Author/Title.pdf', 'flatten'],
    ['A/B/Social Engineering: The Art.pdf', 'A/B/Social Engineering_ The Art.pdf', 'unsafeCharacters'],
    ['Katie Kitamura/Audition (2025)/Audition (2025).epub', 'Kitamura, Katie/Audition (2025)/Audition (2025).epub', 'folderRenamed'],
    ['A/B/Old Name.epub', 'A/B/A Completely Different Name.epub', 'filenameRebuilt'],
  ]

  it.each(cases)('classifies %s', (from, to, expected) => {
    expect(classifyChange(from, to).key).toBe(expected)
  })

  it('never leaves the detail empty for a real rename', () => {
    const detailed = cases.filter(([, , expected]) => expected !== 'unsafeCharacters')
    const empty = detailed.filter(([from, to]) => classifyChange(from, to).detail === '')

    expect(empty).toEqual([])
  })

  it('does not mistake a spacing fix for a removed year', () => {
    const kind = classifyChange('J. K. Rowling/Harry Potter.epub', 'J.K. Rowling/Harry Potter.epub')
    expect(kind.key).toBe('authorSpelling')
  })
})

describe('patternSegments', () => {
  it('splits on slashes outside optional groups', () => {
    expect(patternSegments('<{authors:first}|Unknown Author>/<{seriesIndex}. >{title}< ({year})>')).toEqual([
      '<{authors:first}|Unknown Author>',
      '<{seriesIndex}. >{title}< ({year})>',
    ])
  })

  it('keeps a slash inside an optional group with its segment', () => {
    expect(patternSegments('{authors}/<{series}/>{title}')).toEqual(['{authors}', '<{series}/>{title}'])
  })
})

describe('explainChange', () => {
  const pattern = '<{authors:first}|Unknown Author>/<{seriesIndex}. >{title}< ({year})>/<{seriesIndex}. >{title}< ({year})>'

  it('attributes the leaf to the pattern filename segment', () => {
    const reasons = explainChange('A/B/Old.epub', 'A/B/New.epub', pattern)

    expect(reasons).toHaveLength(1)
    expect(reasons[0]!.level).toBe('filename')
    expect(reasons[0]!.source).toBe('<{seriesIndex}. >{title}< ({year})>')
    expect(reasons[0]!.tokens).toEqual(['{seriesIndex}', '{title}', '{year}'])
  })

  it('attributes the first folder to the pattern top segment', () => {
    const reasons = explainChange('Helen  Fitzgerald/B/C.epub', 'Helen FitzGerald/B/C.epub', pattern)

    expect(reasons[0]!.level).toBe('top')
    expect(reasons[0]!.source).toBe('<{authors:first}|Unknown Author>')
  })

  it('reports a dropped level as removed, with no pattern source', () => {
    const reasons = explainChange(
      'Aisling Elizabeth/The Key Stone Pack/01. Bound by Fate (2023)/01. Bound by Fate (2023).azw3',
      'Aisling Elizabeth/Bound by Fate (2023)/Bound by Fate (2023).azw3',
      pattern,
    )

    expect(reasons[0]!.level).toBe('removed')
    expect(reasons[0]!.source).toBeNull()
    expect(reasons[0]!.tokens).toEqual([])
  })

  it('returns nothing when the path did not change', () => {
    expect(explainChange('A/B/C.epub', 'A/B/C.epub', pattern)).toEqual([])
  })
})

describe('stripRoot', () => {
  it('removes the matching library root', () => {
    expect(stripRoot('/books/Novels/Author/Title.epub', ['/books/Novels'])).toBe('Author/Title.epub')
  })

  it('prefers the longest matching root', () => {
    expect(stripRoot('/books/Novels/Sub/Title.epub', ['/books', '/books/Novels'])).toBe('Sub/Title.epub')
  })

  it('normalises separators and duplicate slashes before matching', () => {
    expect(stripRoot('/books//Novels/Author/Title.epub', ['/books/Novels/'])).toBe('Author/Title.epub')
  })

  it('leaves a path that sits outside every root', () => {
    expect(stripRoot('/elsewhere/Title.epub', ['/books/Novels'])).toBe('/elsewhere/Title.epub')
  })

  it('does not treat a sibling folder as a root match', () => {
    expect(stripRoot('/books/NovelsExtra/Title.epub', ['/books/Novels'])).toBe('/books/NovelsExtra/Title.epub')
  })
})
