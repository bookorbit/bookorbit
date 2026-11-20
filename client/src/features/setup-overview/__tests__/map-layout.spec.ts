import { describe, expect, it } from 'vitest'

import { layoutStacked, layoutWide, textBoxes, wideNeededWidth, type MapLayout, type MapText, type Measure, type TextBox } from '../lib/map-layout'

/** A deliberately generous estimate, so a layout that passes here has room to spare in a browser. */
const measure: Measure = (text, size, weight) => text.length * size * (weight >= 600 ? 0.62 : 0.56)

const node = (id: string, label: string, sub = '', icon = 'check') => ({ id, icon, label, sub })

const MAP: MapText = {
  lanes: [
    {
      id: 'asked',
      caption: 'Asked for',
      entries: [node('request', 'A request', '', 'inbox')],
      stations: [node('searched', 'Searched', '4 sources', 'search'), node('downloaded', 'Downloaded', 'qBittorrent', 'download')],
      into: 'dock-files',
      note: 'checked at 70',
      branch: null,
    },
    {
      id: 'dropped',
      caption: 'Dropped in',
      entries: [node('upload', 'An upload', '', 'upload'), node('dock-folder', 'The dock folder', '', 'folder-input')],
      stations: [
        node('dock-read', 'Read', 'always'),
        node('dock-matched', 'Matched', 'best score wins'),
        node('dock-files', 'Files itself', 'at 85%'),
      ],
      into: null,
      note: '',
      branch: { at: 'dock-files', label: '1 on hold' },
    },
    {
      id: 'disk',
      caption: 'Already on disk',
      entries: [node('library-folder', 'A library folder', '', 'folder-search')],
      stations: [node('scanned', 'Scanned', '4 watched, 2 scheduled', 'rotate-cw')],
      into: null,
      note: '',
      branch: null,
    },
  ],
  library: { label: 'Your library', sub: '1,059 books', foot: '6 libraries' },
  out: [
    node('kobo', 'Kobo', '2 devices', 'folder-sync'),
    node('koreader', 'KOReader', '1 account syncing', 'tablet'),
    node('opds', 'OPDS', '1 account', 'rss'),
    node('email', 'Email', '1 provider', 'mail'),
  ],
  services: [
    { ...node('metadata', 'Metadata', '9 providers, per field', 'tag'), asks: 'dock-matched' },
    { ...node('ai', 'The AI', '2 connections, up to $25 a month', 'sparkles'), asks: null },
  ],
  dockTab: 'The dock',
  outCaption: 'Going out',
  servicesCaption: 'Asked by the others, not a flow of their own',
}

/** Every label half as long again, the way a German or Finnish catalog runs. */
function longer(map: MapText): MapText {
  const grow = (s: string) => (s ? `${s} ${s.slice(0, Math.ceil(s.length / 2))}` : s)
  const n = <T extends { label: string; sub: string }>(x: T): T => ({ ...x, label: grow(x.label), sub: grow(x.sub) })
  return {
    ...map,
    lanes: map.lanes.map((lane) => ({
      ...lane,
      caption: grow(lane.caption),
      entries: lane.entries.map(n),
      stations: lane.stations.map(n),
      note: grow(lane.note),
      branch: lane.branch ? { ...lane.branch, label: grow(lane.branch.label) } : null,
    })),
    library: { label: grow(map.library.label), sub: grow(map.library.sub), foot: grow(map.library.foot) },
    out: map.out.map(n),
    services: map.services.map(n),
  }
}

/** Points along a path made of M, L and C commands, which is all the layout writes. */
function samplePath(d: string): Array<[number, number]> {
  const tokens = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? []
  const points: Array<[number, number]> = []
  let i = 0
  let cx = 0
  let cy = 0
  while (i < tokens.length) {
    const cmd = tokens[i++]
    const num = () => Number(tokens[i++])
    if (cmd === 'M') {
      cx = num()
      cy = num()
      points.push([cx, cy])
    } else if (cmd === 'L') {
      const x = num()
      const y = num()
      for (let s = 1; s <= 24; s++) points.push([cx + ((x - cx) * s) / 24, cy + ((y - cy) * s) / 24])
      cx = x
      cy = y
    } else if (cmd === 'C') {
      const [x1, y1, x2, y2, x, y] = [num(), num(), num(), num(), num(), num()]
      for (let s = 1; s <= 40; s++) {
        const t = s / 40
        const u = 1 - t
        points.push([
          u ** 3 * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x,
          u ** 3 * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y,
        ])
      }
      cx = x
      cy = y
    }
  }
  return points
}

const overlaps = (a: TextBox, b: TextBox, pad = 1) =>
  a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad

function problems(layout: MapLayout): string[] {
  const found: string[] = []
  const boxes = textBoxes(layout, measure)

  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b) => {
      if (overlaps(a, b)) found.push(`"${a.text}" overlaps "${b.text}"`)
    }),
  )

  for (const box of boxes) {
    if (box.left < -1 || box.right > layout.width + 1)
      found.push(`"${box.text}" leaves the drawing (${Math.round(box.left)}..${Math.round(box.right)} of ${layout.width})`)
  }

  // A label on its own pill hides the wire it sits on; that one is meant to be there.
  const onPill = (box: TextBox) =>
    layout.rects.some((r) => r.onWire && box.left >= r.x - 1 && box.right <= r.x + r.w + 1 && box.top >= r.y - 1 && box.bottom <= r.y + r.h + 1)
  const lines = [...layout.wires.map((w) => ({ d: w.d, kind: 'wire' })), ...layout.dashes.map((d) => ({ d: d.d, kind: 'dashed line' }))]
  for (const line of lines) {
    const points = samplePath(line.d)
    for (const box of boxes.filter((b) => !onPill(b))) {
      const hit = points.find(([x, y]) => x > box.left + 1 && x < box.right - 1 && y > box.top + 1 && y < box.bottom - 1)
      if (hit) found.push(`a ${line.kind} runs through "${box.text}" at ${hit.map(Math.round).join(',')}`)
    }
  }

  for (const line of lines) {
    const points = samplePath(line.d)
    for (const dot of layout.dots) {
      const hit = points.find(([x, y]) => Math.hypot(x - dot.cx, y - dot.cy) < dot.r - 1)
      if (hit) found.push(`a ${line.kind} runs through the "${dot.id}" circle`)
    }
    for (const r of layout.rects.filter((x) => x.fill !== 'band' && x.fill !== 'tint' && !x.onWire)) {
      const hit = points.find(([x, y]) => x > r.x + 2 && x < r.x + r.w - 2 && y > r.y + 2 && y < r.y + r.h - 2)
      if (hit) found.push(`a ${line.kind} runs under the box at ${Math.round(r.x)},${Math.round(r.y)} (${hit.map(Math.round).join(',')})`)
    }
  }

  const solid = layout.rects.filter((r) => r.fill !== 'band' && r.fill !== 'tint')
  solid.forEach((a, i) =>
    solid.slice(i + 1).forEach((b) => {
      const box = (r: typeof a) => ({ text: '', left: r.x, right: r.x + r.w, top: r.y, bottom: r.y + r.h })
      if (overlaps(box(a), box(b))) found.push(`two boxes collide at ${Math.round(a.x)},${Math.round(a.y)} and ${Math.round(b.x)},${Math.round(b.y)}`)
    }),
  )
  return found
}

const VARIANTS: Array<[string, MapText]> = [
  ['as written', MAP],
  ['with long translations', longer(MAP)],
]

describe('the wide map', () => {
  describe.each(VARIANTS)('%s', (_name, map) => {
    it.each([0, 1.1, 1.4])('draws nothing over anything at %s times its narrowest width', (factor) => {
      expect(problems(layoutWide(map, measure, wideNeededWidth(map, measure) * factor))).toEqual([])
    })
  })

  it('keeps the shape the mock approved: three lanes, the dock band, the library, four ways out and two services', () => {
    const layout = layoutWide(MAP, measure, 0)
    expect(layout.rects.filter((r) => r.fill === 'band')).toHaveLength(1)
    expect(layout.library).not.toBeNull()
    expect(layout.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['ASKED FOR', 'DROPPED IN', 'ALREADY ON DISK', 'GOING OUT', 'THE DOCK']))
    expect(layout.dots.map((d) => d.id)).toEqual([
      'searched',
      'downloaded',
      'dock-read',
      'dock-matched',
      'dock-files',
      'scanned',
      'kobo',
      'koreader',
      'opds',
      'email',
    ])
    expect(layout.texts.filter((t) => t.text === 'Metadata' || t.text === 'The AI')).toHaveLength(2)
  })

  it('sends the request lane into the dock rather than past it', () => {
    const layout = layoutWide(MAP, measure, 0)
    const files = layout.dots.find((d) => d.id === 'dock-files')!
    const downloaded = layout.dots.find((d) => d.id === 'downloaded')!
    const intoDock = layout.wires.find((w) => w.hue === 'requests' && w.arrow)!
    const end = samplePath(intoDock.d).at(-1)!
    expect(Math.abs(end[0] - files.cx)).toBeLessThan(1)
    expect(end[1]).toBeLessThan(files.cy - files.r)
    expect(samplePath(intoDock.d)[0]![1]).toBe(downloaded.cy)
  })

  it('goes straight to the library when there is no dock to join', () => {
    const map: MapText = { ...MAP, lanes: [{ ...MAP.lanes[0]!, into: null }, MAP.lanes[2]!] }
    expect(problems(layoutWide(map, measure, 0))).toEqual([])
  })

  it('draws a map with only one way in', () => {
    const map: MapText = { ...MAP, lanes: [MAP.lanes[1]!], services: [] }
    expect(problems(layoutWide(map, measure, 0))).toEqual([])
  })
})

describe('the stacked map', () => {
  describe.each(VARIANTS)('%s', (_name, map) => {
    it.each([300, 360, 520, 760])('draws nothing over anything at %spx', (width) => {
      expect(problems(layoutStacked(map, measure, width))).toEqual([])
    })
  })

  it('names where each lane goes instead of drawing wires across the others', () => {
    const texts = layoutStacked(MAP, measure, 360).texts.map((t) => t.text)
    expect(texts.filter((t) => t === 'Files itself')).toHaveLength(2)
    expect(texts.filter((t) => t === 'Your library').length).toBeGreaterThanOrEqual(3)
  })
})
