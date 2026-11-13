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

export function renderConicalFold(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceCanvas: HTMLCanvasElement,
  geometry: FoldGeometry,
  revealedCanvas: HTMLCanvasElement | null = null,
  isDark = false,
  shadowIntensity = 0.65,
) {
  const { midpoint, foldLine, foldAngle, normal, reflectedPolygon, foldDistance } = geometry
  const [p1, p2] = foldLine

  ctx.clearRect(0, 0, width, height)

  // 1. Base Layer: Unpeeled front page portion (page N)
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
  ctx.restore()

  // 2. Revealed Layer: Page N+1 underneath in peel cutout
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
    }
  }

  // Soft drop shadow cast from the fold line onto revealed page
  const shadowWidth = Math.min(100, Math.max(25, foldDistance * 0.3))
  ctx.translate(midpoint.x, midpoint.y)
  ctx.rotate(foldAngle)

  const outerGrad = ctx.createLinearGradient(0, -shadowWidth, 0, shadowWidth)
  const shadowAlpha = Math.min(0.7, shadowIntensity * (0.35 + (foldDistance / (width * 1.5)) * 0.45))
  outerGrad.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`)
  outerGrad.addColorStop(0.2, `rgba(0, 0, 0, ${shadowAlpha * 0.6})`)
  outerGrad.addColorStop(0.5, `rgba(0, 0, 0, ${shadowAlpha * 0.2})`)
  outerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = outerGrad
  ctx.fillRect(-width * 2, 0, width * 4, shadowWidth)
  ctx.restore()

  // 3. Curled Backside Layer: Mirrored page N with warm cream texture & cylindrical lighting
  ctx.save()
  ctx.beginPath()
  if (reflectedPolygon.length >= 3) {
    ctx.moveTo(reflectedPolygon[0]!.x, reflectedPolygon[0]!.y)
    for (let i = 1; i < reflectedPolygon.length; i++) {
      ctx.lineTo(reflectedPolygon[i]!.x, reflectedPolygon[i]!.y)
    }
    ctx.closePath()
    ctx.clip()

    // Mirror transform across fold line
    ctx.translate(midpoint.x, midpoint.y)
    ctx.rotate(foldAngle)
    ctx.scale(1, -1)
    ctx.rotate(-foldAngle)
    ctx.translate(-midpoint.x, -midpoint.y)

    // Draw source page mirrored
    ctx.drawImage(sourceCanvas, 0, 0, width, height)

    // Warm cream paper backside texture
    const tintColor = isDark ? 'rgba(32, 32, 34, 0.94)' : 'rgba(248, 244, 236, 0.92)'
    ctx.fillStyle = tintColor
    ctx.fillRect(0, 0, width, height)

    // Curved cylindrical highlight / shading across backside
    const backGrad = ctx.createLinearGradient(midpoint.x, midpoint.y, midpoint.x + normal.x * 240, midpoint.y + normal.y * 240)
    backGrad.addColorStop(0, isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.09)')
    backGrad.addColorStop(0.3, isDark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.02)')
    backGrad.addColorStop(0.7, isDark ? 'rgba(0, 0, 0, 0.28)' : 'rgba(0, 0, 0, 0.09)')
    backGrad.addColorStop(1, isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.2)')
    ctx.fillStyle = backGrad
    ctx.fillRect(0, 0, width, height)
  }
  ctx.restore()

  // 4. Crease Highlight & Inner Shadow along the fold edge
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.lineWidth = 2.5
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.75)'
  ctx.stroke()

  ctx.translate(midpoint.x, midpoint.y)
  ctx.rotate(foldAngle)
  const creaseWidth = 32
  const innerGrad = ctx.createLinearGradient(0, 0, 0, -creaseWidth)
  innerGrad.addColorStop(0, isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.4)')
  innerGrad.addColorStop(0.2, isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.45)')
  innerGrad.addColorStop(0.5, isDark ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.12)')
  innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = innerGrad
  ctx.fillRect(-width * 2, -creaseWidth, width * 4, creaseWidth)
  ctx.restore()
}
