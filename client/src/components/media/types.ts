export interface MediaBufferedRange {
  start: number
  end: number
}

export interface MediaScrubberMarker {
  position: number
  kind: 'chapter' | 'bookmark'
  label?: string
  active?: boolean
}

export interface MediaScrubberTooltip {
  primary: string
  secondary?: string
}

export interface MediaTransportLabels {
  play: string
  pause: string
  previous: string
  next: string
  back: string
  forward: string
}
