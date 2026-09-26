export declare class TTS {
  constructor(doc: Document, textWalker: unknown, highlightCallback: (range: Range) => void, granularity: string)
  start(): string | null
  resume(): string | null
  prev(paused?: boolean): string | null
  next(paused?: boolean): string | null
  from(range: Range): string | null
  setMark(mark: string): void
}
