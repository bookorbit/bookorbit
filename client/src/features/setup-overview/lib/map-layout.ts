import type { SetupFlowId, SetupMapLaneId } from '@bookorbit/types'

/**
 * The map's geometry, kept apart from the component so it can be checked without a browser.
 *
 * The wide layout is the approved mock's own: the same captions, lanes, dock band, library and
 * columns, at the same proportions. What the mock fixed by hand is measured here instead, so a long
 * name or a translation moves its neighbours rather than running into them. It is drawn in design
 * units and scaled to the card. Below the width that keeps its smallest text readable, the same
 * content is stacked down the card in real pixels.
 */

export type Measure = (text: string, size: number, weight: number, letterSpacing?: number) => number

export interface MapNodeText {
  id: string
  icon: string
  label: string
  sub: string
}

export interface MapLaneText {
  id: SetupMapLaneId
  caption: string
  entries: MapNodeText[]
  stations: MapNodeText[]
  into: string | null
  note: string
  branch: { at: string; label: string } | null
}

export interface MapServiceText extends MapNodeText {
  asks: string | null
}

export interface MapText {
  lanes: MapLaneText[]
  library: { label: string; sub: string; foot: string }
  out: MapNodeText[]
  services: MapServiceText[]
  dockTab: string
  outCaption: string
  servicesCaption: string
}

/** A colour by role. `landed` is where books end up; the rest are the flows' own hues. */
export type MapHue = SetupFlowId | 'landed' | 'warning'

export interface MapText2D {
  x: number
  y: number
  text: string
  size: number
  weight: number
  anchor: 'start' | 'middle'
  tone: 'foreground' | 'muted' | 'hue'
  hue?: MapHue
  letterSpacing?: number
}

export interface MapWire {
  d: string
  hue: MapHue
  arrow: boolean
  /** A wire nothing travels along continuously, such as a scan, gets no moving dash. */
  still: boolean
  opacity: number
}

export interface MapDash {
  d: string
  hue: MapHue
  arrow: boolean
}

export interface MapRect {
  x: number
  y: number
  w: number
  h: number
  rx: number
  fill: 'card' | 'tint' | 'band' | 'warning'
  hue: MapHue
  strokeOpacity: number
  /** A label sitting on the wire it names; its fill hides the wire under it, which is the point. */
  onWire?: boolean
}

export interface MapDot {
  id: string
  cx: number
  cy: number
  r: number
  hue: MapHue
  icon: string
}

export interface MapIcon {
  x: number
  y: number
  size: number
  icon: string
  hue: MapHue
}

export interface MapLibrary {
  cx: number
  cy: number
  r: number
  icon: string
}

export interface MapLayout {
  kind: 'wide' | 'stacked'
  width: number
  height: number
  rects: MapRect[]
  wires: MapWire[]
  dashes: MapDash[]
  dots: MapDot[]
  icons: MapIcon[]
  texts: MapText2D[]
  library: MapLibrary | null
}

export const LANE_HUE: Record<SetupMapLaneId, SetupFlowId> = { asked: 'requests', dropped: 'ingest', disk: 'ingest' }

const SERVICE_HUE: Record<string, SetupFlowId> = { metadata: 'metadata', ai: 'ai' }
export const serviceHue = (id: string): MapHue => SERVICE_HUE[id] ?? 'metadata'

/* ---------- Type scale, in design units. The wide map is scaled up to fit, so these are minimums. ---------- */
const CAPTION = { size: 9, weight: 700, spacing: 0.11 }
const CHIP = { size: 11, weight: 400 }
const STATION_LABEL = { size: 10.5, weight: 600 }
const STATION_SUB = { size: 9.5, weight: 400 }
const PILL = { size: 9.5, weight: 600 }
const OUT_LABEL = { size: 11.5, weight: 600 }
const OUT_SUB = { size: 10, weight: 400 }
const SERVICE_LABEL = { size: 11, weight: 600 }
const SERVICE_SUB = { size: 9.5, weight: 400 }
const LIB_LABEL = { size: 11, weight: 600 }
const LIB_SUB = { size: 9.5, weight: 400 }
const LIB_FOOT = { size: 10, weight: 400 }

/** The smallest text is 9 design units; under this scale it would draw below 8.5px. */
export const MIN_SCALE = 0.95
/** Over this the map stops growing and spreads out instead, so the text never balloons. */
export const MAX_SCALE = 1.22

const LX = 16
const TOP = 36
const STATION_R = 18
const OUT_R = 17
const LIB_R = 46
const CHIP_H = 32
const CHIP_STEP = 44
const LANE_GAP = 16

const r1 = (n: number) => Math.round(n * 10) / 10
const caps = (text: string) => text.toLocaleUpperCase()

/** Text width with its letter spacing, which canvas measurement leaves out. */
function captionWidth(measure: Measure, text: string, size = CAPTION.size): number {
  return measure(caps(text), size, CAPTION.weight) + caps(text).length * size * CAPTION.spacing
}

interface StationPos {
  id: string
  lane: number
  x: number
  y: number
  /** The lowest point of the text under the station. */
  bottom: number
}

/** How wide the wide map has to be before anything touches, in design units. */
export function wideNeededWidth(text: MapText, measure: Measure): number {
  return layoutWide(text, measure, 0).width
}

/**
 * The wide map, laid out at `width` design units or the narrowest width that fits, whichever is
 * larger. Extra width goes into the two long runs, into the library and out to the devices, which is
 * where the mock has its air.
 */
export function layoutWide(text: MapText, measure: Measure, width: number): MapLayout {
  const out: MapLayout = { kind: 'wide', width: 0, height: 0, rects: [], wires: [], dashes: [], dots: [], icons: [], texts: [], library: null }
  const lanes = text.lanes.filter((lane) => lane.entries.length > 0 || lane.stations.length > 0)

  const chipW = Math.max(128, ...lanes.flatMap((lane) => lane.entries.map((e) => measure(e.label, CHIP.size, CHIP.weight) + 48)))
  const chipRight = LX + chipW
  const stationText = lanes.flatMap((lane) =>
    lane.stations.map((s) =>
      Math.max(measure(s.label, STATION_LABEL.size, STATION_LABEL.weight), measure(s.sub, STATION_SUB.size, STATION_SUB.weight)),
    ),
  )
  const spacing = Math.max(96, ...stationText.map((w) => w + 22))
  const firstText = lanes.map((lane) => lane.stations[0]).filter((s): s is MapNodeText => s !== undefined)
  const firstWidest = Math.max(
    0,
    ...firstText.map((s) =>
      Math.max(measure(s.label, STATION_LABEL.size, STATION_LABEL.weight), measure(s.sub, STATION_SUB.size, STATION_SUB.weight)),
    ),
  )
  const col0 = chipRight + Math.max(67, firstWidest / 2 + 24)
  const colX = (i: number) => col0 + i * spacing

  /* ---------- Rows: each lane takes the height it needs, top to bottom ---------- */
  type Row = {
    lane: MapLaneText
    index: number
    y: number
    band: { top: number; bottom: number; left: number; right: number } | null
    captionY: number
    bottom: number
  }
  const rows: Row[] = []
  let cursor = TOP - 8
  lanes.forEach((lane, index) => {
    const spread = (Math.max(1, lane.entries.length) - 1) * (CHIP_STEP / 2)
    const isBand = lane.id === 'dropped'
    let y: number
    let band: Row['band'] = null
    if (isBand) {
      const tabTop = index === 0 ? TOP - 8 : cursor + LANE_GAP
      y = Math.max(tabTop + 10 + 52, tabTop + 26 + spread + 16)
      const right = colX(Math.max(0, lane.stations.length - 1)) + 99
      band = { top: y - 52, bottom: y + 56, left: col0 - 49, right }
    } else {
      const captionY = index === 0 ? TOP : cursor + LANE_GAP + 8
      y = captionY + 30 + spread
    }
    const chipsTop = y - spread - CHIP_H / 2
    const captionY = isBand ? Math.min(chipsTop - 12, (band?.top ?? 0) + 2) : chipsTop - 14
    let bottom = lane.stations.length > 0 ? y + 51 : y + spread + CHIP_H / 2
    if (band) bottom = Math.max(bottom, band.bottom)
    if (lane.branch && lane.stations.some((s) => s.id === lane.branch?.at)) bottom = Math.max(bottom, y + 83)
    rows.push({ lane, index, y, band, captionY, bottom })
    cursor = bottom
  })

  const stations: StationPos[] = rows.flatMap((row) =>
    row.lane.stations.map((s, i) => ({ id: s.id, lane: row.index, x: colX(i), y: row.y, bottom: row.band ? row.band.bottom : row.y + 51 })),
  )
  const stationById = new Map(stations.map((s) => [s.id, s]))

  /* ---------- Where the lanes end, which decides where the library can sit ---------- */
  let laneRight = chipRight + 40
  let holdRight = 0
  for (const row of rows) {
    const last = row.lane.stations.length - 1
    laneRight = Math.max(laneRight, row.band ? row.band.right : last >= 0 ? colX(last) + STATION_R + 40 : chipRight + 40)
    if (row.lane.branch) {
      const at = row.lane.stations.findIndex((s) => s.id === row.lane.branch?.at)
      if (at >= 0) holdRight = Math.max(holdRight, colX(at) + 37 + Math.max(72, measure(row.lane.branch.label, PILL.size, PILL.weight) + 30))
    }
  }

  const dockRow = rows.find((row) => row.band)
  const ly = dockRow ? dockRow.y : rows.length > 0 ? (rows[0]!.y + rows[rows.length - 1]!.y) / 2 : TOP + 120
  const minLx = Math.max(laneRight + 120, holdRight + 130)

  const outText = text.out.map((o) => Math.max(measure(o.label, OUT_LABEL.size, OUT_LABEL.weight), measure(o.sub, OUT_SUB.size, OUT_SUB.weight)))
  const outTail = OUT_R + 7 + Math.max(60, ...outText) + 16
  const minOx = minLx + 168
  const needed = Math.max(minOx + outTail, chipRight + 200)
  const extra = Math.max(0, width - needed)
  const lx = minLx + extra * 0.42
  const ox = minOx + extra
  out.width = Math.max(width, needed)

  /* ---------- Captions and entry chips ---------- */
  for (const row of rows) {
    const hue = LANE_HUE[row.lane.id]
    out.texts.push(caption(LX, row.captionY, row.lane.caption))
    const entries = row.lane.entries
    const spread = (Math.max(1, entries.length) - 1) * (CHIP_STEP / 2)
    entries.forEach((entry, i) => {
      const cy = row.y - spread + i * CHIP_STEP
      out.rects.push({ x: LX, y: cy - CHIP_H / 2, w: chipW, h: CHIP_H, rx: 10, fill: 'card', hue, strokeOpacity: 0.34 })
      out.icons.push({ x: LX + 18, y: cy, size: 13, icon: entry.icon, hue })
      out.texts.push({ x: LX + 32, y: cy + 4, text: entry.label, size: CHIP.size, weight: CHIP.weight, anchor: 'start', tone: 'foreground' })
      const first = row.lane.stations.length > 0 ? colX(0) - STATION_R - 3 : null
      if (first === null) return
      const d =
        cy === row.y
          ? `M ${chipRight} ${cy} L ${first} ${row.y}`
          : `M ${chipRight} ${cy} C ${chipRight + 18} ${cy} ${chipRight + 14} ${row.y} ${first} ${row.y}`
      out.wires.push({ d, hue, arrow: false, still: row.lane.id === 'disk', opacity: row.lane.id === 'disk' ? 0.34 : 0.42 })
    })
  }

  /* ---------- The dock band ---------- */
  if (dockRow?.band) {
    const b = dockRow.band
    const hue = LANE_HUE.dropped
    out.rects.unshift({ x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top, rx: 16, fill: 'band', hue, strokeOpacity: 0.28 })
    const tabW = captionWidth(measure, text.dockTab) + 24
    out.rects.push({ x: b.left + 14, y: b.top - 10, w: tabW, h: 20, rx: 7, fill: 'card', hue, strokeOpacity: 0.32 })
    out.texts.push({ ...caption(b.left + 26, b.top + 4, text.dockTab), tone: 'hue', hue })
  }

  /* ---------- Stations and the wires between them ---------- */
  for (const row of rows) {
    const hue = LANE_HUE[row.lane.id]
    const still = row.lane.id === 'disk'
    row.lane.stations.forEach((s, i) => {
      const x = colX(i)
      out.dots.push({ id: s.id, cx: x, cy: row.y, r: STATION_R, hue, icon: s.icon })
      out.texts.push({
        x,
        y: row.y + 34,
        text: s.label,
        size: STATION_LABEL.size,
        weight: STATION_LABEL.weight,
        anchor: 'middle',
        tone: 'foreground',
      })
      if (s.sub)
        out.texts.push({ x, y: row.y + 47, text: s.sub, size: STATION_SUB.size, weight: STATION_SUB.weight, anchor: 'middle', tone: 'foreground' })
      if (i > 0)
        out.wires.push({
          d: `M ${colX(i - 1) + STATION_R + 3} ${row.y} L ${x - STATION_R - 3} ${row.y}`,
          hue,
          arrow: false,
          still,
          opacity: still ? 0.34 : 0.48,
        })
    })
  }

  /* ---------- Where each lane hands its books on ---------- */
  const libEntry = (angle: number) => ({ x: r1(lx - (LIB_R + 12) * Math.cos(angle)), y: r1(ly + (LIB_R + 12) * Math.sin(angle)) })
  const turnX = Math.max(laneRight - 40, holdRight) + 12
  for (const row of rows) {
    const hue = LANE_HUE[row.lane.id]
    const last = row.lane.stations.length - 1
    if (last < 0) continue
    const sx = colX(last) + STATION_R + 3
    const target = row.lane.into ? stationById.get(row.lane.into) : undefined

    if (target && target.lane !== row.index && target.x >= sx + 40) {
      // Into a station on another lane, from above: across, then straight down onto it.
      const down = target.y > row.y
      const ty = down ? target.y - STATION_R - 4 : target.y + STATION_R + 4
      const bendX = Math.max(sx + 12, target.x - 30)
      const d = `M ${sx} ${row.y} L ${bendX} ${row.y} C ${target.x - 6} ${row.y} ${target.x} ${row.y + (down ? 24 : -24)} ${target.x} ${row.y + (down ? 48 : -48)} L ${target.x} ${ty}`
      out.wires.push({ d, hue, arrow: true, still: false, opacity: 0.48 })
      if (row.lane.note) {
        const w = measure(row.lane.note, PILL.size, PILL.weight) + 20
        const prevSub = row.lane.stations[last]!
        const clear =
          colX(last) +
          Math.max(measure(prevSub.sub, STATION_SUB.size, STATION_SUB.weight), measure(prevSub.label, STATION_LABEL.size, STATION_LABEL.weight)) / 2 +
          8
        const top = target.lane === dockRow?.index && dockRow.band ? dockRow.band.top - 10 : ty
        const cy = down ? (row.y + 51 + top) / 2 : (row.y - 20 + top) / 2
        pill(out, Math.max(target.x, clear + w / 2), cy, w, row.lane.note, hue)
      }
      continue
    }

    if (row.band) {
      out.wires.push({ d: `M ${sx} ${row.y} L ${lx - LIB_R - 14} ${ly}`, hue, arrow: true, still: false, opacity: 0.48 })
    } else if (row.y > ly) {
      const end = libEntry((-35 * Math.PI) / 180)
      const end2 = { x: end.x, y: r1(ly + (LIB_R + 12) * Math.sin((35 * Math.PI) / 180)) }
      const run = Math.max(turnX, sx + 10)
      out.wires.push({
        d: `M ${sx} ${row.y} L ${run} ${row.y} C ${run + (end2.x - run) * 0.6} ${row.y} ${end2.x - 22} ${end2.y + 34} ${end2.x} ${end2.y}`,
        hue,
        arrow: true,
        still: row.lane.id === 'disk',
        opacity: row.lane.id === 'disk' ? 0.34 : 0.48,
      })
    } else {
      const end = { x: r1(lx - (LIB_R + 12) * Math.cos((35 * Math.PI) / 180)), y: r1(ly - (LIB_R + 12) * Math.sin((35 * Math.PI) / 180)) }
      const run = Math.max(laneRight - 20, sx + 10)
      out.wires.push({
        d: `M ${sx} ${row.y} L ${run} ${row.y} C ${run + (end.x - run) * 0.6} ${row.y} ${end.x - 22} ${end.y - 34} ${end.x} ${end.y}`,
        hue,
        arrow: true,
        still: false,
        opacity: 0.48,
      })
      if (row.lane.note) {
        const w = measure(row.lane.note, PILL.size, PILL.weight) + 20
        pill(out, (sx + run) / 2 + 6, row.y, w, row.lane.note, hue)
      }
    }
  }

  /* ---------- Work on hold, hanging off its station below the band ---------- */
  for (const row of rows) {
    const branch = row.lane.branch
    const at = branch ? row.lane.stations.findIndex((s) => s.id === branch.at) : -1
    if (!branch || at < 0) continue
    const x = colX(at)
    const w = Math.max(72, measure(branch.label, PILL.size, PILL.weight) + 30)
    const px = x + 37
    const py = row.y + 61
    out.dashes.push({ d: `M ${x} ${row.y + 52} C ${x} ${py + 11} ${px - 14} ${py + 11} ${px - 3} ${py + 11}`, hue: 'warning', arrow: false })
    out.rects.push({ x: px, y: py, w, h: 22, rx: 9, fill: 'warning', hue: 'warning', strokeOpacity: 0.45 })
    out.texts.push({
      x: px + w / 2,
      y: py + 15,
      text: branch.label,
      size: PILL.size,
      weight: PILL.weight,
      anchor: 'middle',
      tone: 'hue',
      hue: 'warning',
    })
  }

  /* ---------- The library ---------- */
  out.library = { cx: lx, cy: ly, r: LIB_R, icon: 'library' }
  const libLabelSize = Math.min(
    LIB_LABEL.size,
    (LIB_LABEL.size * (LIB_R * 1.7)) / Math.max(1, measure(text.library.label, LIB_LABEL.size, LIB_LABEL.weight)),
  )
  const libSubSize = Math.min(LIB_SUB.size, (LIB_SUB.size * (LIB_R * 1.6)) / Math.max(1, measure(text.library.sub, LIB_SUB.size, LIB_SUB.weight)))
  out.texts.push({
    x: lx,
    y: ly + 13,
    text: text.library.label,
    size: r1(libLabelSize),
    weight: LIB_LABEL.weight,
    anchor: 'middle',
    tone: 'foreground',
  })
  if (text.library.sub)
    out.texts.push({ x: lx, y: ly + 26, text: text.library.sub, size: r1(libSubSize), weight: LIB_SUB.weight, anchor: 'middle', tone: 'foreground' })
  if (text.library.foot)
    out.texts.push({ x: lx, y: ly + 72, text: text.library.foot, size: LIB_FOOT.size, weight: LIB_FOOT.weight, anchor: 'middle', tone: 'foreground' })

  /* ---------- Going out ---------- */
  let outBottom = 0
  if (text.out.length > 0) {
    const step = 62
    const first = Math.max(TOP + 30, ly - ((text.out.length - 1) * step) / 2)
    out.texts.push(caption(ox - OUT_R - 1, first - 30, text.outCaption))
    text.out.forEach((o, i) => {
      const y = first + i * step
      out.wires.push({
        d: `M ${lx + LIB_R + 4} ${ly} C ${lx + 94} ${ly} ${ox - 64} ${y} ${ox - OUT_R - 4} ${y}`,
        hue: 'out',
        arrow: true,
        still: false,
        opacity: 0.4,
      })
      out.dots.push({ id: o.id, cx: ox, cy: y, r: OUT_R, hue: 'out', icon: o.icon })
      out.texts.push({
        x: ox + OUT_R + 7,
        y: y - 1,
        text: o.label,
        size: OUT_LABEL.size,
        weight: OUT_LABEL.weight,
        anchor: 'start',
        tone: 'foreground',
      })
      if (o.sub)
        out.texts.push({ x: ox + OUT_R + 7, y: y + 12, text: o.sub, size: OUT_SUB.size, weight: OUT_SUB.weight, anchor: 'start', tone: 'foreground' })
      outBottom = y + OUT_R
    })
  }

  /* ---------- Asked by the others ---------- */
  const lanesBottom = Math.max(cursor, ly + 72 + 6, outBottom)
  let height = lanesBottom + 12
  if (text.services.length > 0) {
    const top = lanesBottom + 27
    const boxes = text.services
      .map((s) => {
        const target = s.asks ? stationById.get(s.asks) : undefined
        const tx = target ? target.x : lx
        const ty = target ? target.bottom : ly + 72 + 6
        const w = Math.max(measure(s.label, SERVICE_LABEL.size, SERVICE_LABEL.weight), measure(s.sub, SERVICE_SUB.size, SERVICE_SUB.weight)) + 60
        return { s, tx, ty, w }
      })
      .sort((a, b) => a.tx - b.tx)
    // Left to right with a gap, then the whole row is pulled back in if it runs off the right.
    let prevRight = LX - 24
    const lefts = boxes.map((box) => {
      const left = Math.max(box.tx - box.w / 2, prevRight + 24, LX)
      prevRight = left + box.w
      return left
    })
    const overflow = Math.max(0, prevRight - (out.width - 16))
    const shift = Math.min(overflow, Math.max(0, (lefts[0] ?? LX) - LX))
    boxes.forEach((box, i) => {
      const left = (lefts[i] ?? LX) - shift
      const hue = serviceHue(box.s.id)
      const cx = left + box.w / 2
      const d =
        Math.abs(cx - box.tx) < 1
          ? `M ${box.tx} ${top} L ${box.tx} ${box.ty}`
          : `M ${cx} ${top} C ${cx} ${top - 40} ${box.tx} ${box.ty + 40} ${box.tx} ${box.ty}`
      out.dashes.push({ d, hue, arrow: false })
      out.rects.push({ x: left, y: top, w: box.w, h: 40, rx: 12, fill: 'card', hue, strokeOpacity: 0.38 })
      out.rects.push({ x: left + 11, y: top + 7, w: 26, h: 26, rx: 13, fill: 'tint', hue, strokeOpacity: 0 })
      out.icons.push({ x: left + 24, y: top + 20, size: 14, icon: box.s.icon, hue })
      out.texts.push({
        x: left + 44,
        y: top + 17,
        text: box.s.label,
        size: SERVICE_LABEL.size,
        weight: SERVICE_LABEL.weight,
        anchor: 'start',
        tone: 'foreground',
      })
      if (box.s.sub)
        out.texts.push({
          x: left + 44,
          y: top + 30,
          text: box.s.sub,
          size: SERVICE_SUB.size,
          weight: SERVICE_SUB.weight,
          anchor: 'start',
          tone: 'foreground',
        })
    })
    out.texts.push(caption(Math.max(LX, (lefts[0] ?? LX) - shift), top + 60, text.servicesCaption))
    height = top + 70
  }
  out.height = Math.ceil(height)
  return out
}

function caption(x: number, y: number, text: string): MapText2D {
  return { x, y, text: caps(text), size: CAPTION.size, weight: CAPTION.weight, anchor: 'start', tone: 'muted', letterSpacing: CAPTION.spacing }
}

function pill(out: MapLayout, cx: number, cy: number, w: number, text: string, hue: MapHue): void {
  out.rects.push({ x: r1(cx - w / 2), y: cy - 10, w: r1(w), h: 20, rx: 10, fill: 'card', hue, strokeOpacity: 0.45, onWire: true })
  out.texts.push({ x: cx, y: cy + 3.5, text, size: PILL.size, weight: /\d/.test(text) ? 600 : 500, anchor: 'middle', tone: 'foreground' })
}

/* ---------- Narrow cards: the same content, stacked, in real pixels ---------- */

const S = {
  pad: 2,
  nodeX: 22,
  r: 15,
  textX: 48,
  step: 52,
  chipH: 30,
  caption: { size: 10, weight: 700 },
  chip: { size: 12, weight: 400 },
  label: { size: 12.5, weight: 600 },
  sub: { size: 11, weight: 400 },
}

/** Up to `lines` lines of whole words, the last one cut short with an ellipsis if it still runs over. */
function wrap(measure: Measure, value: string, size: number, weight: number, maxWidth: number, lines = 2, spacing = 0): string[] {
  const fits = (t: string) => measure(t, size, weight) + t.length * size * spacing <= maxWidth
  if (!value || fits(value)) return value ? [value] : []
  const words = value.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (fits(next) || !line) line = next
    else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  const kept = out.slice(0, lines)
  if (out.length > lines) kept[lines - 1] = `${kept[lines - 1]} ${out.slice(lines).join(' ')}`
  return kept.map((l) => {
    if (fits(l)) return l
    let cut = l
    while (cut.length > 1 && !fits(`${cut}…`)) cut = cut.slice(0, -1)
    return `${cut.trimEnd()}…`
  })
}

export function layoutStacked(text: MapText, measure: Measure, width: number): MapLayout {
  const out: MapLayout = { kind: 'stacked', width, height: 0, rects: [], wires: [], dashes: [], dots: [], icons: [], texts: [], library: null }
  const one = (value: string, size: number, weight: number, maxWidth: number) => wrap(measure, value, size, weight, maxWidth, 1)[0] ?? ''
  const lanes = text.lanes.filter((lane) => lane.entries.length > 0 || lane.stations.length > 0)
  const stationLabel = new Map(
    lanes.flatMap((lane) => lane.stations.map((s) => [s.id, { label: s.label, hue: LANE_HUE[lane.id] as MapHue }] as const)),
  )
  const right = width - S.pad
  let y = 4

  const stackCaption = (t: string, x = S.pad) => {
    const lines = wrap(measure, caps(t), S.caption.size, S.caption.weight, right - x, 2, CAPTION.spacing)
    lines.forEach((line, i) => {
      out.texts.push({
        x,
        y: y + 10 + i * 13,
        text: line,
        size: S.caption.size,
        weight: S.caption.weight,
        anchor: 'start',
        tone: 'muted',
        letterSpacing: CAPTION.spacing,
      })
    })
    y += 22 + (lines.length - 1) * 13
  }

  for (const lane of lanes) {
    const hue = LANE_HUE[lane.id]
    const isBand = lane.id === 'dropped'
    stackCaption(lane.caption)

    // Entry chips, wrapped to the card.
    let x = S.pad
    let rowTop = y
    const chipBottoms: number[] = []
    for (const entry of lane.entries) {
      const w = Math.min(right - S.pad, measure(entry.label, S.chip.size, S.chip.weight) + 44)
      if (x > S.pad && x + w > right) {
        x = S.pad
        rowTop += S.chipH + 8
      }
      out.rects.push({ x, y: rowTop, w, h: S.chipH, rx: 9, fill: 'card', hue, strokeOpacity: 0.34 })
      out.icons.push({ x: x + 17, y: rowTop + S.chipH / 2, size: 13, icon: entry.icon, hue })
      out.texts.push({
        x: x + 32,
        y: rowTop + S.chipH / 2 + 4,
        text: one(entry.label, S.chip.size, S.chip.weight, w - 42),
        size: S.chip.size,
        weight: S.chip.weight,
        anchor: 'start',
        tone: 'foreground',
      })
      chipBottoms.push(rowTop + S.chipH)
      x += w + 8
    }
    y = (chipBottoms.length ? Math.max(...chipBottoms) : y) + (isBand ? 22 : 14)

    const bandTop = y - 8
    let cy = y + S.r + (isBand ? 6 : 0)
    const first = cy
    lane.stations.forEach((s, i) => {
      if (i > 0)
        out.wires.push({
          d: `M ${S.nodeX} ${cy - S.step + S.r + 3} L ${S.nodeX} ${cy - S.r - 3}`,
          hue,
          arrow: false,
          still: lane.id === 'disk',
          opacity: 0.48,
        })
      out.dots.push({ id: s.id, cx: S.nodeX, cy, r: S.r, hue, icon: s.icon })
      const room = right - (isBand ? 10 : 0) - S.textX
      const label = one(s.label, S.label.size, S.label.weight, room)
      const sub = one(s.sub, S.sub.size, S.sub.weight, room)
      out.texts.push({ x: S.textX, y: cy - 1, text: label, size: S.label.size, weight: S.label.weight, anchor: 'start', tone: 'foreground' })
      if (sub) out.texts.push({ x: S.textX, y: cy + 13, text: sub, size: S.sub.size, weight: S.sub.weight, anchor: 'start', tone: 'foreground' })

      if (lane.branch?.at === s.id) {
        const w = Math.max(64, measure(lane.branch.label, PILL.size + 1, PILL.weight) + 24)
        const textRight = S.textX + Math.max(measure(label, S.label.size, S.label.weight), measure(sub, S.sub.size, S.sub.weight))
        const px = right - (isBand ? 10 : 0) - w
        if (px > textRight + 10) {
          out.rects.push({ x: px, y: cy - 11, w, h: 22, rx: 9, fill: 'warning', hue: 'warning', strokeOpacity: 0.45 })
          out.texts.push({
            x: px + w / 2,
            y: cy + 3.5,
            text: lane.branch.label,
            size: PILL.size + 1,
            weight: PILL.weight,
            anchor: 'middle',
            tone: 'hue',
            hue: 'warning',
          })
        }
      }
      cy += S.step
    })
    const lastY = cy - S.step
    if (lane.stations.length > 0 && chipBottoms.length) {
      out.wires.push({
        d: `M ${S.nodeX} ${Math.max(...chipBottoms) + 2} L ${S.nodeX} ${first - S.r - 3}`,
        hue,
        arrow: false,
        still: lane.id === 'disk',
        opacity: 0.42,
      })
    }
    if (isBand && lane.stations.length > 0) {
      const bottom = lastY + S.r + 28
      out.rects.unshift({ x: S.pad, y: bandTop, w: right - S.pad, h: bottom - bandTop, rx: 14, fill: 'band', hue, strokeOpacity: 0.28 })
      // The tab sits right of the wire that comes down into the band, never on it.
      const tabW = captionWidth(measure, text.dockTab, S.caption.size - 1) + 20
      out.rects.push({ x: S.textX - 6, y: bandTop - 9, w: tabW, h: 18, rx: 6, fill: 'card', hue, strokeOpacity: 0.32 })
      out.texts.push({
        x: S.textX + 4,
        y: bandTop + 3.5,
        text: caps(text.dockTab),
        size: S.caption.size - 1,
        weight: S.caption.weight,
        anchor: 'start',
        tone: 'hue',
        hue,
        letterSpacing: CAPTION.spacing,
      })
    }

    // Where this lane's books go next, named rather than drawn across the other lanes.
    const start = lane.stations.length > 0 ? lastY + S.r + 3 : y
    const endTop = start + (isBand ? 34 : 26)
    out.wires.push({ d: `M ${S.nodeX} ${start} L ${S.nodeX} ${endTop - 4}`, hue, arrow: true, still: lane.id === 'disk', opacity: 0.48 })
    const target = lane.into ? stationLabel.get(lane.into) : undefined
    const label = one(target ? target.label : text.library.label, S.sub.size, 600, right - S.nodeX - 34)
    const targetHue: MapHue = target ? target.hue : 'landed'
    const w = measure(label, S.sub.size, 600) + 22
    out.rects.push({ x: S.nodeX - 12, y: endTop, w, h: 22, rx: 11, fill: 'card', hue: targetHue, strokeOpacity: 0.5 })
    out.texts.push({ x: S.nodeX - 12 + w / 2, y: endTop + 15, text: label, size: S.sub.size, weight: 600, anchor: 'middle', tone: 'foreground' })
    if (lane.note) {
      const nx = S.nodeX - 12 + w + 10
      if (nx + measure(lane.note, S.sub.size, 500) < right) {
        out.texts.push({ x: nx, y: endTop + 15, text: lane.note, size: S.sub.size, weight: 500, anchor: 'start', tone: 'foreground' })
      }
    }
    y = endTop + 22 + 22
  }

  // The library.
  const libR = 28
  const ly = y + libR + 6
  out.library = { cx: S.nodeX + 6, cy: ly, r: libR, icon: 'library' }
  const libX = S.nodeX + 6 + libR + 16
  const libRoom = right - libX
  const joined = [text.library.sub, text.library.foot].filter(Boolean).join(' · ')
  // One line when both facts fit side by side, otherwise one under the other.
  const facts =
    measure(joined, S.sub.size, 400) <= libRoom
      ? [joined]
      : [text.library.sub, text.library.foot].filter(Boolean).map((f) => one(f, S.sub.size, 400, libRoom))
  const libTop = ly - 4 - (facts.length - 1) * 7
  out.texts.push({ x: libX, y: libTop, text: one(text.library.label, 13, 600, libRoom), size: 13, weight: 600, anchor: 'start', tone: 'foreground' })
  facts.forEach((fact, i) =>
    out.texts.push({ x: libX, y: libTop + 16 + i * 14, text: fact, size: S.sub.size, weight: 400, anchor: 'start', tone: 'foreground' }),
  )
  y = ly + libR + 18

  // Going out.
  if (text.out.length > 0) {
    // Indented past the wires that run down from the library, so none of them crosses it.
    stackCaption(text.outCaption, S.nodeX + 18)
    const top = y
    text.out.forEach((o, i) => {
      const oy = top + 18 + i * 46
      const dx = S.nodeX + 30
      out.wires.push({
        d: `M ${S.nodeX + 6} ${ly + libR + 4} C ${S.nodeX + 6} ${oy - 16} ${S.nodeX + 6} ${oy} ${dx - 18} ${oy}`,
        hue: 'out',
        arrow: true,
        still: i > 0,
        opacity: 0.34,
      })
      out.dots.push({ id: o.id, cx: dx, cy: oy, r: 15, hue: 'out', icon: o.icon })
      out.texts.push({
        x: dx + 24,
        y: oy - 1,
        text: one(o.label, S.label.size, S.label.weight, right - dx - 24),
        size: S.label.size,
        weight: S.label.weight,
        anchor: 'start',
        tone: 'foreground',
      })
      if (o.sub)
        out.texts.push({
          x: dx + 24,
          y: oy + 13,
          text: one(o.sub, S.sub.size, 400, right - dx - 24),
          size: S.sub.size,
          weight: 400,
          anchor: 'start',
          tone: 'foreground',
        })
    })
    y = top + 18 + (text.out.length - 1) * 46 + 15 + 22
  }

  // Asked by the others.
  if (text.services.length > 0) {
    stackCaption(text.servicesCaption)
    for (const s of text.services) {
      const hue = serviceHue(s.id)
      const w = right - S.pad
      const room = w - 56
      const subLines = wrap(measure, s.sub, S.sub.size, 400, room)
      const h = 42 + Math.max(0, subLines.length - 1) * 13
      out.rects.push({ x: S.pad, y, w, h, rx: 12, fill: 'card', hue, strokeOpacity: 0.38 })
      out.rects.push({ x: S.pad + 10, y: y + h / 2 - 13, w: 26, h: 26, rx: 13, fill: 'tint', hue, strokeOpacity: 0 })
      out.icons.push({ x: S.pad + 23, y: y + h / 2, size: 14, icon: s.icon, hue })
      out.texts.push({ x: S.pad + 46, y: y + 18, text: one(s.label, 12, 600, room), size: 12, weight: 600, anchor: 'start', tone: 'foreground' })
      subLines.forEach((line, i) =>
        out.texts.push({ x: S.pad + 46, y: y + 32 + i * 13, text: line, size: S.sub.size, weight: 400, anchor: 'start', tone: 'foreground' }),
      )
      y += h + 8
    }
  }

  out.height = Math.ceil(y + 4)
  return out
}

/* ---------- Checks the tests use, kept here so they read the same geometry the page draws ---------- */

export interface TextBox {
  text: string
  left: number
  right: number
  top: number
  bottom: number
}

export function textBoxes(layout: MapLayout, measure: Measure): TextBox[] {
  return layout.texts.map((t) => {
    const w = measure(t.text, t.size, t.weight) + (t.letterSpacing ? t.text.length * t.size * t.letterSpacing : 0)
    const left = t.anchor === 'middle' ? t.x - w / 2 : t.x
    return { text: t.text, left, right: left + w, top: t.y - t.size * 0.78, bottom: t.y + t.size * 0.22 }
  })
}
