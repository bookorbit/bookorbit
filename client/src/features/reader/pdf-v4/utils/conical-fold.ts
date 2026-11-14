export interface Point {
  x: number
  y: number
}

export type Corner = 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left'

export interface FoldGeometry {
  active: boolean
  corner: Corner
  cornerPoint: Point
  touchPoint: Point
  midpoint: Point
  foldLine: [Point, Point]
  foldAngle: number
  normal: Point
  peelPolygon: Point[]
  reflectedPolygon: Point[]
  foldDistance: number
  /** 0..1 progress toward full page turn */
  progress: number
}

export function getCornerPoint(corner: Corner, width: number, height: number): Point {
  switch (corner) {
    case 'bottom-right':
      return { x: width, y: height }
    case 'top-right':
      return { x: width, y: 0 }
    case 'bottom-left':
      return { x: 0, y: height }
    case 'top-left':
      return { x: 0, y: 0 }
  }
}

export function calculateFoldGeometry(width: number, height: number, corner: Corner, touchPoint: Point): FoldGeometry | null {
  const cornerPoint = getCornerPoint(corner, width, height)
  const vx = touchPoint.x - cornerPoint.x
  const vy = touchPoint.y - cornerPoint.y
  const distance = Math.hypot(vx, vy)

  if (distance < 2) return null

  const nx = vx / distance
  const ny = vy / distance

  const mx = cornerPoint.x + vx / 2
  const my = cornerPoint.y + vy / 2

  // Intersections of perpendicular bisector (fold line) with page rect
  const intersections: Point[] = []

  if (Math.abs(nx) > 1e-5) {
    const xTop = mx + (ny * my) / nx
    if (xTop >= -0.5 && xTop <= width + 0.5) {
      intersections.push({ x: Math.max(0, Math.min(width, xTop)), y: 0 })
    }
    const xBot = mx - (ny * (height - my)) / nx
    if (xBot >= -0.5 && xBot <= width + 0.5) {
      intersections.push({ x: Math.max(0, Math.min(width, xBot)), y: height })
    }
  }

  if (Math.abs(ny) > 1e-5) {
    const yLeft = my + (nx * mx) / ny
    if (yLeft >= -0.5 && yLeft <= height + 0.5) {
      intersections.push({ x: 0, y: Math.max(0, Math.min(height, yLeft)) })
    }
    const yRight = my - (nx * (width - mx)) / ny
    if (yRight >= -0.5 && yRight <= height + 0.5) {
      intersections.push({ x: width, y: Math.max(0, Math.min(height, yRight)) })
    }
  }

  const unique: Point[] = []
  for (const pt of intersections) {
    if (!unique.some((u) => Math.hypot(u.x - pt.x, u.y - pt.y) < 1)) {
      unique.push(pt)
    }
  }

  if (unique.length < 2) return null

  const p1 = unique[0]!
  const p2 = unique[1]!
  const foldAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x)

  function reflectPoint(pt: Point): Point {
    const dot = nx * (pt.x - mx) + ny * (pt.y - my)
    return { x: pt.x - 2 * dot * nx, y: pt.y - 2 * dot * ny }
  }

  const allCorners: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]

  const peelCorners: Point[] = []
  for (const c of allCorners) {
    if (nx * (c.x - mx) + ny * (c.y - my) < -0.1) {
      peelCorners.push(c)
    }
  }

  const peelVertices = [p1, ...peelCorners, p2]
  const cx = peelVertices.reduce((s, p) => s + p.x, 0) / peelVertices.length
  const cy = peelVertices.reduce((s, p) => s + p.y, 0) / peelVertices.length
  peelVertices.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))

  const reflectedPolygon = peelVertices.map(reflectPoint)

  // Compute progress as ratio of fold travel vs. max diagonal
  const maxDiag = Math.hypot(width, height)
  const progress = Math.min(1, distance / maxDiag)

  return {
    active: true,
    corner,
    cornerPoint,
    touchPoint,
    midpoint: { x: mx, y: my },
    foldLine: [p1, p2],
    foldAngle,
    normal: { x: nx, y: ny },
    peelPolygon: peelVertices,
    reflectedPolygon,
    foldDistance: distance,
    progress,
  }
}

// ---------------------------------------------------------------------------
// Procedural paper grain — cached singleton
// ---------------------------------------------------------------------------
let cachedGrain: HTMLCanvasElement | null = null

export function getPaperGrainCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (cachedGrain) return cachedGrain

  try {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Fine-grained warm noise
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() - 0.5) * 18
      d[i] = Math.max(0, Math.min(255, 245 + v))
      d[i + 1] = Math.max(0, Math.min(255, 240 + v))
      d[i + 2] = Math.max(0, Math.min(255, 232 + v))
      d[i + 3] = Math.floor(100 + Math.random() * 60)
    }
    ctx.putImageData(img, 0, 0)

    // Subtle fiber strands
    ctx.lineWidth = 0.4
    ctx.globalAlpha = 0.1
    ctx.strokeStyle = '#8B7355'
    for (let i = 0; i < 30; i++) {
      const x0 = Math.random() * size
      const y0 = Math.random() * size
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.quadraticCurveTo(
        x0 + (Math.random() - 0.5) * 18,
        y0 + (Math.random() - 0.5) * 18,
        x0 + (Math.random() - 0.5) * 14,
        y0 + (Math.random() - 0.5) * 14,
      )
      ctx.stroke()
    }

    cachedGrain = canvas
    return canvas
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function tracePolygon(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length < 3) return
  ctx.beginPath()
  ctx.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
  ctx.closePath()
}

function isFoldEdge(a: Point, b: Point, p1: Point, p2: Point): boolean {
  const d1 = Math.hypot(a.x - p1.x, a.y - p1.y) + Math.hypot(b.x - p2.x, b.y - p2.y)
  const d2 = Math.hypot(a.x - p2.x, a.y - p2.y) + Math.hypot(b.x - p1.x, b.y - p1.y)
  return d1 < 5 || d2 < 5
}

/**
 * Traces the reflected polygon with organic Bezier curves along the free
 * curling edges and straight segments along the fold crease.
 */
function traceCurvedBackside(ctx: CanvasRenderingContext2D, geom: FoldGeometry) {
  const { reflectedPolygon, foldLine, foldDistance } = geom
  if (reflectedPolygon.length < 3) return
  const [p1, p2] = foldLine

  const cx = reflectedPolygon.reduce((s, p) => s + p.x, 0) / reflectedPolygon.length
  const cy = reflectedPolygon.reduce((s, p) => s + p.y, 0) / reflectedPolygon.length
  const bulge = Math.min(32, Math.max(6, foldDistance * 0.06))

  ctx.beginPath()
  ctx.moveTo(reflectedPolygon[0]!.x, reflectedPolygon[0]!.y)

  for (let i = 0; i < reflectedPolygon.length; i++) {
    const a = reflectedPolygon[i]!
    const b = reflectedPolygon[(i + 1) % reflectedPolygon.length]!

    if (isFoldEdge(a, b, p1, p2)) {
      ctx.lineTo(b.x, b.y)
    } else {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const dx = mx - cx
      const dy = my - cy
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        ctx.quadraticCurveTo(mx + (dx / len) * bulge, my + (dy / len) * bulge, b.x, b.y)
      } else {
        ctx.lineTo(b.x, b.y)
      }
    }
  }
  ctx.closePath()
}

export function renderConicalFold(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceCanvas: HTMLCanvasElement,
  geometry: FoldGeometry,
  revealedCanvas: HTMLCanvasElement | null = null,
  isDark = false,
  isSepia = false,
) {
  const { midpoint, foldLine, foldAngle, normal, reflectedPolygon, foldDistance, progress } = geometry
  const [p1, p2] = foldLine

  ctx.clearRect(0, 0, width, height)

  // Perpendicular direction from fold line into the revealed page area
  // (opposite to normal which points toward the touch/corner)
  const perpX = -normal.x
  const perpY = -normal.y

  // ------------------------------------------------------------------
  // Layer 1: Static page N (everything NOT peeled away)
  // ------------------------------------------------------------------
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  if (geometry.peelPolygon.length >= 3) {
    tracePolygon(ctx, geometry.peelPolygon)
  }
  ctx.clip('evenodd')
  ctx.drawImage(sourceCanvas, 0, 0, width, height)

  // Soft ambient shadow just ahead of the fold crease on page N
  const ambW = Math.min(22, 8 + foldDistance * 0.02)
  const ambAlpha = (isDark ? 0.4 : 0.28) * Math.min(1, progress * 3)
  const ambGrad = ctx.createLinearGradient(midpoint.x, midpoint.y, midpoint.x + perpX * ambW, midpoint.y + perpY * ambW)
  ambGrad.addColorStop(0, `rgba(0,0,0,${ambAlpha})`)
  ambGrad.addColorStop(0.5, `rgba(0,0,0,${ambAlpha * 0.3})`)
  ambGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = ambGrad
  ctx.fillRect(0, 0, width, height)

  // Spine gutter on left binding edge
  const spineGrad = ctx.createLinearGradient(0, 0, 24, 0)
  spineGrad.addColorStop(0, isDark ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.12)')
  spineGrad.addColorStop(0.4, isDark ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.04)')
  spineGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = spineGrad
  ctx.fillRect(0, 0, 24, height)
  ctx.restore()

  // ------------------------------------------------------------------
  // Layer 2: Revealed page N+1 (inside the peel cutout)
  // ------------------------------------------------------------------
  ctx.save()
  if (geometry.peelPolygon.length >= 3) {
    tracePolygon(ctx, geometry.peelPolygon)
    ctx.clip()

    if (revealedCanvas) {
      ctx.drawImage(revealedCanvas, 0, 0, width, height)
    } else {
      ctx.fillStyle = isDark ? '#1a1a1e' : isSepia ? '#f5ead5' : '#faf8f4'
      ctx.fillRect(0, 0, width, height)
    }

    // Wide soft drop shadow cast by the curling page onto the revealed page
    // Gradient runs from fold line INTO the revealed page (perpendicular direction)
    const shadowW = Math.min(width * 0.4, Math.max(30, foldDistance * 0.55))
    const shadowAlpha = Math.min(0.5, 0.18 + progress * 0.32)
    const dropGrad = ctx.createLinearGradient(midpoint.x, midpoint.y, midpoint.x + perpX * shadowW, midpoint.y + perpY * shadowW)
    dropGrad.addColorStop(0, `rgba(0,0,0,${shadowAlpha})`)
    dropGrad.addColorStop(0.25, `rgba(0,0,0,${shadowAlpha * 0.45})`)
    dropGrad.addColorStop(0.6, `rgba(0,0,0,${shadowAlpha * 0.12})`)
    dropGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = dropGrad
    ctx.fillRect(0, 0, width, height)

    // Spine gutter on revealed page
    ctx.fillStyle = spineGrad
    ctx.fillRect(0, 0, 24, height)
  }
  ctx.restore()

  // ------------------------------------------------------------------
  // Layer 3: Curled backside flap (the signature layer)
  // ------------------------------------------------------------------
  if (reflectedPolygon.length < 3) return

  ctx.save()
  traceCurvedBackside(ctx, geometry)
  ctx.clip()

  // 3a. Paper-back base color
  const backColor = isDark ? '#222226' : isSepia ? '#ede4d0' : '#f0ece4'
  ctx.fillStyle = backColor
  ctx.fillRect(0, 0, width, height)

  // 3b. Subtle paper grain overlay
  const grain = getPaperGrainCanvas()
  if (grain) {
    try {
      const pat = ctx.createPattern(grain, 'repeat')
      if (pat) {
        ctx.save()
        ctx.globalCompositeOperation = isDark ? 'screen' : 'multiply'
        ctx.globalAlpha = isDark ? 0.06 : 0.08
        ctx.fillStyle = pat
        ctx.fillRect(0, 0, width, height)
        ctx.restore()
      }
    } catch {}
  }

  // 3c. Ink bleed-through — reflection of page N across the fold line
  ctx.save()
  ctx.globalAlpha = isDark ? 0.08 : 0.13
  try {
    ctx.filter = 'blur(0.8px)'
  } catch {}
  // Affine transform: translate to midpoint, rotate to fold axis, flip across axis, rotate back
  ctx.translate(midpoint.x, midpoint.y)
  ctx.rotate(foldAngle)
  ctx.scale(1, -1)
  ctx.rotate(-foldAngle)
  ctx.translate(-midpoint.x, -midpoint.y)
  ctx.drawImage(sourceCanvas, 0, 0, width, height)
  ctx.restore()

  // 3d. Cylindrical roll lighting — multi-stop gradient perpendicular to fold
  const rollLen = Math.max(60, Math.min(width * 0.8, foldDistance * 0.9))
  const rollGrad = ctx.createLinearGradient(midpoint.x, midpoint.y, midpoint.x + normal.x * rollLen, midpoint.y + normal.y * rollLen)
  if (isDark) {
    rollGrad.addColorStop(0.0, 'rgba(0,0,0,0.50)')
    rollGrad.addColorStop(0.12, 'rgba(255,255,255,0.20)')
    rollGrad.addColorStop(0.25, 'rgba(255,255,255,0.08)')
    rollGrad.addColorStop(0.6, 'rgba(0,0,0,0.05)')
    rollGrad.addColorStop(1.0, 'rgba(0,0,0,0.30)')
  } else if (isSepia) {
    rollGrad.addColorStop(0.0, 'rgba(60,40,10,0.25)')
    rollGrad.addColorStop(0.12, 'rgba(255,248,230,0.50)')
    rollGrad.addColorStop(0.25, 'rgba(255,248,230,0.15)')
    rollGrad.addColorStop(0.6, 'rgba(60,40,10,0.03)')
    rollGrad.addColorStop(1.0, 'rgba(60,40,10,0.12)')
  } else {
    rollGrad.addColorStop(0.0, 'rgba(0,0,0,0.24)')
    rollGrad.addColorStop(0.12, 'rgba(255,252,245,0.52)')
    rollGrad.addColorStop(0.25, 'rgba(255,252,245,0.14)')
    rollGrad.addColorStop(0.6, 'rgba(0,0,0,0.02)')
    rollGrad.addColorStop(1.0, 'rgba(0,0,0,0.10)')
  }
  ctx.fillStyle = rollGrad
  ctx.fillRect(0, 0, width, height)

  ctx.restore()

  // ------------------------------------------------------------------
  // Layer 4: Fold crease line + inner shadow band
  // ------------------------------------------------------------------
  ctx.save()

  // Thin bright crease highlight along the fold edge
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.lineWidth = isDark ? 1.2 : 1.5
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.70)'
  ctx.stroke()

  // Inner shadow band on the backside of the fold
  ctx.translate(midpoint.x, midpoint.y)
  ctx.rotate(foldAngle)
  const creaseW = Math.min(24, 10 + foldDistance * 0.02)
  const igAlpha = isDark ? 0.45 : 0.3
  const innerGrad = ctx.createLinearGradient(0, 0, 0, -creaseW)
  innerGrad.addColorStop(0, `rgba(0,0,0,${igAlpha})`)
  innerGrad.addColorStop(0.15, isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.30)')
  innerGrad.addColorStop(0.5, `rgba(0,0,0,${igAlpha * 0.25})`)
  innerGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = innerGrad
  ctx.fillRect(-width * 2, -creaseW, width * 4, creaseW)

  // Matching shadow band on the front side (page N side of fold)
  const outerGrad = ctx.createLinearGradient(0, 0, 0, creaseW * 0.7)
  outerGrad.addColorStop(0, `rgba(0,0,0,${igAlpha * 0.7})`)
  outerGrad.addColorStop(0.3, `rgba(0,0,0,${igAlpha * 0.15})`)
  outerGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = outerGrad
  ctx.fillRect(-width * 2, 0, width * 4, creaseW * 0.7)

  ctx.restore()
}
