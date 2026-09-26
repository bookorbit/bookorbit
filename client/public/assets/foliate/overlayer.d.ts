export declare class Overlayer {
  add(key: string, range: Range, draw: (rects: DOMRectList, opts: unknown) => Element, options?: unknown): void
  remove(key: string): void
  redraw(): void
  static highlight(rects: DOMRectList, options?: { color?: string }): Element
  static underline(rects: DOMRectList, options?: { color?: string; width?: number }): Element
  static strikethrough(rects: DOMRectList, options?: { color?: string; width?: number }): Element
  static squiggly(rects: DOMRectList, options?: { color?: string; width?: number }): Element
  static outline(rects: DOMRectList, options?: { color?: string; width?: number; radius?: number }): Element
}
