const DEFAULT_ARTWORK_SIZE = 512

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load cover artwork'))
    image.src = src
  })
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, size: number, mode: 'fill' | 'fit', overscan = 1) {
  const scale =
    (mode === 'fill'
      ? Math.max(size / image.naturalWidth, size / image.naturalHeight)
      : Math.min(size / image.naturalWidth, size / image.naturalHeight)) * overscan
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
}

export async function createCoverFillArtworkUrl(src: string, size = DEFAULT_ARTWORK_SIZE): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || size <= 0) return null

  try {
    const image = await loadImage(src)
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.save()
    ctx.filter = `blur(${Math.max(12, Math.round(size * 0.06))}px) brightness(0.75)`
    drawCover(ctx, image, size, 'fill', 1.15)
    ctx.restore()

    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
    ctx.fillRect(0, 0, size, size)
    drawCover(ctx, image, size, 'fit')

    const blob = await canvasBlob(canvas)
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}
