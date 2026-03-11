export interface AnnotationEntry {
  color: string
  style: string
}

export function useFoliateAnnotations() {
  const annotationStyleMap = new Map<string, AnnotationEntry>()

  function createSVG(tag: string): SVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', tag)
  }

  function getDrawFunction(style: string) {
    switch (style) {
      case 'underline':
        return (rects: DOMRectList, { color = 'red' }: { color?: string } = {}) => {
          const g = createSVG('g')
          g.setAttribute('fill', color)
          for (const { left, bottom, width } of Array.from(rects)) {
            const el = createSVG('rect')
            el.setAttribute('x', String(left))
            el.setAttribute('y', String(bottom - 2))
            el.setAttribute('height', '2')
            el.setAttribute('width', String(width))
            g.append(el)
          }
          return g
        }
      case 'strikethrough':
        return (rects: DOMRectList, { color = 'red' }: { color?: string } = {}) => {
          const g = createSVG('g')
          g.setAttribute('fill', color)
          for (const { left, top, bottom, width } of Array.from(rects)) {
            const el = createSVG('rect')
            el.setAttribute('x', String(left))
            el.setAttribute('y', String((top + bottom) / 2))
            el.setAttribute('height', '2')
            el.setAttribute('width', String(width))
            g.append(el)
          }
          return g
        }
      case 'squiggly':
        return (rects: DOMRectList, { color = 'red' }: { color?: string } = {}) => {
          const g = createSVG('g')
          g.setAttribute('fill', 'none')
          g.setAttribute('stroke', color)
          g.setAttribute('stroke-width', '2')
          const block = 3
          for (const { left, bottom, width } of Array.from(rects)) {
            const el = createSVG('path')
            const n = Math.round(width / block / 1.5)
            const inline = width / n
            const ls = Array.from({ length: n }, (_, i) => `l${inline} ${i % 2 ? block : -block}`).join('')
            el.setAttribute('d', `M${left} ${bottom}${ls}`)
            g.append(el)
          }
          return g
        }
      default:
        return (rects: DOMRectList, { color = 'yellow' }: { color?: string } = {}) => {
          const g = createSVG('g')
          g.setAttribute('fill', color)
          ;(g as SVGElement).style.opacity = '0.3'
          ;(g as SVGElement).style.mixBlendMode = 'multiply'
          for (const { left, top, height, width } of Array.from(rects)) {
            const el = createSVG('rect')
            el.setAttribute('x', String(left))
            el.setAttribute('y', String(top))
            el.setAttribute('height', String(height))
            el.setAttribute('width', String(width))
            g.append(el)
          }
          return g
        }
    }
  }

  function addAnnotation(view: unknown, cfi: string, color = '#FACC15', style = 'highlight') {
    annotationStyleMap.set(cfi, { color, style })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(view as any)?.addAnnotation?.({ value: cfi })
  }

  function addAnnotations(view: unknown, anns: { cfi: string; color: string; style: string }[]) {
    for (const ann of anns) {
      annotationStyleMap.set(ann.cfi, { color: ann.color, style: ann.style })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(view as any)?.addAnnotation?.({ value: ann.cfi })
    }
  }

  function deleteAnnotation(view: unknown, cfi: string) {
    annotationStyleMap.delete(cfi)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(view as any)?.deleteAnnotation?.({ value: cfi })
  }

  function reAddAll(view: unknown) {
    setTimeout(() => {
      for (const [cfi] of annotationStyleMap) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(view as any)?.addAnnotation?.({ value: cfi })
      }
    }, 100)
  }

  function handleDrawAnnotationEvent(e: CustomEvent) {
    const { draw, annotation } = e.detail ?? {}
    if (!draw || !annotation?.value) return
    const stored = annotationStyleMap.get(annotation.value)
    if (!stored) return
    draw(getDrawFunction(stored.style), { color: stored.color })
  }

  return { annotationStyleMap, getDrawFunction, addAnnotation, addAnnotations, deleteAnnotation, reAddAll, handleDrawAnnotationEvent }
}
