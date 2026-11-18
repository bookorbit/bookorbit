import type { SetupFlowId } from '@bookorbit/types'

/**
 * Signal: cool and warm alternating, so no two flows blur into each other.
 *
 * Every hue is a `--pill-source-*` token, which the theme tunes separately for light and dark.
 * Green is not in the list on purpose: it belongs to where a book lands, and amber and red stay
 * with holds and failures, so nothing decorative borrows a colour that already means something.
 */
export const FLOW_HUE: Record<SetupFlowId, string> = {
  ingest: 'var(--pill-source-blue)',
  requests: 'var(--pill-source-orange)',
  metadata: 'var(--pill-source-indigo)',
  ai: 'var(--pill-source-yellow)',
  out: 'var(--pill-source-green)',
}

/** Where a book has landed, in every flow. */
export const LANDED_HUE = 'var(--pill-source-green)'

/**
 * Yellow and lime sit at the top of the lightness range, so a hairline in them goes faint on a
 * light card. They are drawn a little heavier to land on the same weight as the rest.
 */
export function isFaint(hue: string): boolean {
  return hue.includes('yellow') || hue.includes('lime')
}

export function wireWidth(hue: string): number {
  return isFaint(hue) ? 2.2 : 1.7
}

export function wireOpacity(hue: string): number {
  return isFaint(hue) ? 0.75 : 0.55
}

export function ringOpacity(hue: string): number {
  return isFaint(hue) ? 0.67 : 0.42
}
