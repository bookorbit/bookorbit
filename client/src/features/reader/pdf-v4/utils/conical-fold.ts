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

  // Unit normal pointing from corner towards touch point
  const nx = vx / distance
  const ny = vy / distance

  // Midpoint of the fold line
  const mx = cornerPoint.x + vx / 2
  const my = cornerPoint.y + vy / 2

  // Intersections of fold line with rect [0, width] x [0, height]
  // Fold line equation: nx * (x - mx) + ny * (y - my) = 0
  const intersections: Point[] = []

  // Top edge: y = 0 => nx * (x - mx) - ny * my = 0 => x = mx + ny * my / nx
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

  // Left edge: x = 0 => ny * (y - my) - nx * mx = 0 => y = my + nx * mx / ny
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

  // Deduplicate points
  const uniqueIntersections: Point[] = []
  for (const pt of intersections) {
    if (!uniqueIntersections.some((u) => Math.hypot(u.x - pt.x, u.y - pt.y) < 1)) {
      uniqueIntersections.push(pt)
    }
  }

  if (uniqueIntersections.length < 2) return null

  const p1 = uniqueIntersections[0]!
  const p2 = uniqueIntersections[1]!

  // Tangent angle of fold line
  const foldAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x)

  // Reflection helper: Q' = Q - 2 * (n . (Q - M)) * n
  function reflectPoint(pt: Point): Point {
    const dot = nx * (pt.x - mx) + ny * (pt.y - my)
    return {
      x: pt.x - 2 * dot * nx,
      y: pt.y - 2 * dot * ny,
    }
  }

  // Corners of the page that lie on the same side of the fold as cornerPoint:
  const allCorners: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]

  // Sign of cornerPoint: nx * (cx - mx) + ny * (cy - my) is negative
  const peelCorners: Point[] = []
  for (const c of allCorners) {
    const side = nx * (c.x - mx) + ny * (c.y - my)
    if (side < -0.1) {
      peelCorners.push(c)
    }
  }

  // Build polygon around peel area: p1 -> peelCorners -> p2
  const peelVertices = [p1, ...peelCorners, p2]
  const cx = peelVertices.reduce((sum, p) => sum + p.x, 0) / peelVertices.length
  const cy = peelVertices.reduce((sum, p) => sum + p.y, 0) / peelVertices.length
  peelVertices.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))

  const reflectedPolygon = peelVertices.map(reflectPoint)

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
  }
}

let cachedPaperPatternCanvas: HTMLCanvasElement | null = null

export function getPaperGrainCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (cachedPaperPatternCanvas) return cachedPaperPatternCanvas

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const imgData = ctx.createImageData(256, 256)
    const data = imgData.data
    for (let i = 0; i < data.length; i += 4) {
      // Warm ivory/cream micro-speckle noise
      const n = (Math.random() - 0.5) * 28
      data[i] = Math.max(0, Math.min(255, 248 + n))
      data[i + 1] = Math.max(0, Math.min(255, 244 + n))
      data[i + 2] = Math.max(0, Math.min(255, 235 + n))
      data[i + 3] = Math.floor(180 + Math.random() * 75)
    }
    ctx.putImageData(imgData, 0, 0)

    // Fine organic paper fiber strands
    ctx.lineWidth = 0.6
    ctx.strokeStyle = 'rgba(165, 145, 115, 0.16)'
    for (let i = 0; i < 40; i++) {
      const x1 = Math.random() * 256
      const y1 = Math.random() * 256
      const cx = x1 + (Math.random() - 0.5) * 22
      const cy = y1 + (Math.random() - 0.5) * 22
      const x2 = cx + (Math.random() - 0.5) * 16
      const y2 = cy + (Math.random() - 0.5) * 16
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.quadraticCurveTo(cx, cy, x2, y2)
      ctx.stroke()
    }

    cachedPaperPatternCanvas = canvas
    return canvas
  } catch {
    return null
  }
}

export function applyPaperGrain(ctx: CanvasRenderingContext2D, width: number, height: number, isDark = false, isSepia = false) {
  ctx.save()
  // Subtle warm paper stock tint (#FCF9F2 in Light, #F4EAD5 in Sepia, #1E1E22 in Dark)
  const paperTint = isDark ? '#1E1E22' : isSepia ? '#F4EAD5' : '#FCF9F2'
  ctx.fillStyle = paperTint
  ctx.globalCompositeOperation = isDark ? 'screen' : 'multiply'
  ctx.globalAlpha = isDark ? 0.08 : 0.12
  ctx.fillRect(0, 0, width, height)

  const grainCanvas = getPaperGrainCanvas()
  if (grainCanvas) {
    try {
      const pattern = ctx.createPattern(grainCanvas, 'repeat')
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.globalCompositeOperation = 'multiply'
        ctx.globalAlpha = 0.035
        ctx.fillRect(0, 0, width, height)
      }
    } catch {}
  }
  ctx.restore()
}

function isFoldEdge(a: Point, b: Point, p1: Point, p2: Point): boolean {
  const d1 = Math.hypot(a.x - p1.x, a.y - p1.y) + Math.hypot(b.x - p2.x, b.y - p2.y)
  const d2 = Math.hypot(a.x - p2.x, a.y - p2.y) + Math.hypot(b.x - p1.x, b.y - p1.y)
  return d1 < 5 || d2 < 5
}

export function traceCurvedBacksidePath(ctx: CanvasRenderingContext2D, geometry: FoldGeometry) {
  const { reflectedPolygon, foldLine, foldDistance } = geometry
  if (reflectedPolygon.length < 3) return
  const [p1, p2] = foldLine

  const cx = reflectedPolygon.reduce((s, p) => s + p.x, 0) / reflectedPolygon.length
  const cy = reflectedPolygon.reduce((s, p) => s + p.y, 0) / reflectedPolygon.length
  // Dynamic outward curve along free edges (soft 3D paper cylinder curvature)
  const bulge = Math.min(24, Math.max(4, foldDistance * 0.045))

  ctx.beginPath()
  const start = reflectedPolygon[0]!
  ctx.moveTo(start.x, start.y)

  for (let i = 0; i < reflectedPolygon.length; i++) {
    const a = reflectedPolygon[i]!
    const b = reflectedPolygon[(i + 1) % reflectedPolygon.length]!

    if (isFoldEdge(a, b, p1, p2)) {
      // Crease edge remains straight
      ctx.lineTo(b.x, b.y)
    } else {
      // Free curling paper edge bows outward naturally with quadratic Bezier curve
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const dx = mx - cx
      const dy = my - cy
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        const cpX = mx + (dx / len) * bulge
        const cpY = my + (dy / len) * bulge
        ctx.quadraticCurveTo(cpX, cpY, b.x, b.y)
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
  isSepiaOrShadow: boolean | number = false,
  shadowIntensity = 0.65,
) {
  let isSepia = false
  if (typeof isSepiaOrShadow === 'boolean') {
    isSepia = isSepiaOrShadow
  } else if (typeof isSepiaOrShadow === 'number') {
    shadowIntensity = isSepiaOrShadow
  }

  const { midpoint, foldLine, foldAngle, normal, reflectedPolygon, foldDistance } = geometry
  const [p1, p2] = foldLine

  ctx.clearRect(0, 0, width, height)

  // -------------------------------------------------------------
  // Layer 1: Base unpeeled page N (with paper grain & ambient shadow)
  // -------------------------------------------------------------
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  if (geometry.peelPolygon.length >= 3) {
    ctx.moveTo(geometry.peelPolygon[0]!.x, geometry.peelPolygon[0]!.y)
    for (let i = 1; i < geometry.peelPolygon.length; i++) {
      ctx.lineTo(geometry.peelPolygon[i]!.x, geometry.peelPolygon[i]!.y)
    }
    ctx.closePath()
  }
  ctx.clip('evenodd')
  ctx.drawImage(sourceCanvas, 0, 0, width, height)
  applyPaperGrain(ctx, width, height, isDark, isSepia)

  // Under-curl ambient shadow on page N (14px soft ambient shadow ahead of fold line)
  const ambientWidth = 14
  const ambGrad = ctx.createLinearGradient(midpoint.x, midpoint.y, midpoint.x + normal.x * ambientWidth, midpoint.y + normal.y * ambientWidth)
  const ambAlpha = isDark ? 0.35 : 0.24
  ambGrad.addColorStop(0, `rgba(0, 0, 0, ${ambAlpha})`)
  ambGrad.addColorStop(0.4, `rgba(0, 0, 0, ${ambAlpha * 0.45})`)
  ambGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = ambGrad
  ctx.fillRect(0, 0, width, height)

  // Book spine center gutter (left binding edge 0px to 28px)
  const spineWidth = 28
  const gutterGrad = ctx.createLinearGradient(0, 0, spineWidth, 0)
  gutterGrad.addColorStop(0, isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.16)')
  gutterGrad.addColorStop(0.35, isDark ? 'rgba(0, 0, 0, 0.14)' : 'rgba(0, 0, 0, 0.06)')
  gutterGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gutterGrad
  ctx.fillRect(0, 0, spineWidth, height)
  ctx.restore()

  // -------------------------------------------------------------
  // Layer 2: Revealed Page N+1 (with paper grain & dynamic drop shadow)
  // -------------------------------------------------------------
  ctx.save()
  ctx.beginPath()
  if (geometry.peelPolygon.length >= 3) {
    ctx.moveTo(geometry.peelPolygon[0]!.x, geometry.peelPolygon[0]!.y)
    for (let i = 1; i < geometry.peelPolygon.length; i++) {
      ctx.lineTo(geometry.peelPolygon[i]!.x, geometry.peelPolygon[i]!.y)
    }
    ctx.closePath()
    ctx.clip()

    if (revealedCanvas) {
      ctx.drawImage(revealedCanvas, 0, 0, width, height)
    } else {
      ctx.fillStyle = isDark ? '#1E1E22' : isSepia ? '#F4EAD5' : '#FCF9F2'
      ctx.fillRect(0, 0, width, height)
    }
    applyPaperGrain(ctx, width, height, isDark, isSepia)

    // Dynamic wide drop shadow cast onto revealed page
    const dropShadowWidth = Math.min(180, Math.max(35, foldDistance * 0.45))
    const dropGrad = ctx.createLinearGradient(
      midpoint.x,
      midpoint.y,
      midpoint.x - normal.x * dropShadowWidth,
      midpoint.y - normal.y * dropShadowWidth,
    )
    const dropAlpha = Math.min(0.55, shadowIntensity * (0.38 + (foldDistance / (width * 1.5)) * 0.25))
    dropGrad.addColorStop(0, `rgba(0, 0, 0, ${dropAlpha})`)
    dropGrad.addColorStop(0.35, `rgba(0, 0, 0, ${dropAlpha * 0.37})`)
    dropGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = dropGrad
    ctx.fillRect(0, 0, width, height)

    // Revealed page spine gutter
    const revealedGutter = ctx.createLinearGradient(0, 0, spineWidth, 0)
    revealedGutter.addColorStop(0, isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.16)')
    revealedGutter.addColorStop(0.35, isDark ? 'rgba(0, 0, 0, 0.14)' : 'rgba(0, 0, 0, 0.06)')
    revealedGutter.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = revealedGutter
    ctx.fillRect(0, 0, spineWidth, height)
  }
  ctx.restore()

  // -------------------------------------------------------------
  // Layer 3: Curled Backside (Google Play Books ink bleed-through & 3D roll)
  // -------------------------------------------------------------
  ctx.save()
  if (reflectedPolygon.length >= 3) {
    // Clip using natural curved Bezier boundary
    traceCurvedBacksidePath(ctx, geometry)
    ctx.clip()

    // 1. Warm paper-back base color + grain
    const backBaseColor = isDark ? '#242428' : isSepia ? '#ECE2CC' : '#F3EFE6'
    ctx.fillStyle = backBaseColor
    ctx.fillRect(0, 0, width, height)
    applyPaperGrain(ctx, width, height, isDark, isSepia)

    // 2. Translucent ink bleed-through: mirrored bitmap at 14% opacity with subtle blur
    ctx.save()
    ctx.globalAlpha = 0.14
    try {
      ctx.filter = 'blur(0.6px)'
    } catch {}
    ctx.translate(midpoint.x, midpoint.y)
    ctx.rotate(foldAngle)
    ctx.scale(1, -1)
    ctx.rotate(-foldAngle)
    ctx.translate(-midpoint.x, -midpoint.y)
    ctx.drawImage(sourceCanvas, 0, 0, width, height)
    ctx.restore()

    // 3. Multi-stop Cylindrical 3D Roll Lighting Gradient
    const rollLength = Math.max(70, Math.min(width * 0.9, foldDistance * 0.95))
    const cylGrad = ctx.createLinearGradient(midpoint.x, midpoint.y, midpoint.x + normal.x * rollLength, midpoint.y + normal.y * rollLength)
    if (isDark) {
      cylGrad.addColorStop(0.0, 'rgba(0, 0, 0, 0.45)')
      cylGrad.addColorStop(0.18, 'rgba(255, 255, 255, 0.28)')
      cylGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0.04)')
      cylGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.35)')
    } else if (isSepia) {
      cylGrad.addColorStop(0.0, 'rgba(40, 30, 15, 0.22)')
      cylGrad.addColorStop(0.18, 'rgba(255, 250, 230, 0.55)')
      cylGrad.addColorStop(0.65, 'rgba(240, 225, 200, 0.05)')
      cylGrad.addColorStop(1.0, 'rgba(40, 30, 15, 0.12)')
    } else {
      cylGrad.addColorStop(0.0, 'rgba(0, 0, 0, 0.22)')
      cylGrad.addColorStop(0.18, 'rgba(255, 253, 245, 0.55)')
      cylGrad.addColorStop(0.65, 'rgba(245, 239, 228, 0.05)')
      cylGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.12)')
    }
    ctx.fillStyle = cylGrad
    ctx.fillRect(0, 0, width, height)
  }
  ctx.restore()

  // -------------------------------------------------------------
  // Layer 4: Crease Highlight & Inner Shadow along fold edge
  // -------------------------------------------------------------
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.lineWidth = 2.0
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.85)'
  ctx.stroke()

  ctx.translate(midpoint.x, midpoint.y)
  ctx.rotate(foldAngle)
  const creaseWidth = 28
  const innerGrad = ctx.createLinearGradient(0, 0, 0, -creaseWidth)
  innerGrad.addColorStop(0, isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.35)')
  innerGrad.addColorStop(0.22, isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.4)')
  innerGrad.addColorStop(0.6, isDark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.08)')
  innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = innerGrad
  ctx.fillRect(-width * 2, -creaseWidth, width * 4, creaseWidth)
  ctx.restore()
}
