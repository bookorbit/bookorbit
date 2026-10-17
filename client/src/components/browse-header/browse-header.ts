import type { InjectionKey, Ref } from 'vue'

export type BrowsePlaceKind = 'library' | 'smartScope' | 'collection'

export interface BrowsePlace {
  kind: BrowsePlaceKind
  id: number
}

/** The command bar element, so a facet group can measure the room it has left. */
export const BROWSE_BAR_KEY: InjectionKey<Ref<HTMLElement | null>> = Symbol('browse-bar')

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

/** A borderless control inside the command bar. */
export const barButton = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[13px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`

/** The same control while it holds a value: a picked facet, an open popover, an active filter. */
export const barButtonOn = 'border-primary/45 bg-primary/12 text-primary hover:bg-primary/15'

export const barIconButton = `inline-grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-foreground transition-colors hover:bg-muted ${focusRing}`

/** The title row's page actions, which sit outside the bar and carry a border. */
export const outlineButton = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-input px-3 text-[13px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`

export const barDivider = 'mx-1 h-5 w-px shrink-0 bg-border'

/** The uppercase label in front of an inline facet group, the app's card-label style. */
export const facetLabel = 'shrink-0 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase'

/** A pill-shaped facet chip; `aria-pressed` drives the picked state. */
export const facetChip = `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted aria-pressed:border-primary/45 aria-pressed:bg-primary/12 aria-pressed:text-primary ${focusRing}`

/** A segmented control's track and its segments; `aria-pressed` or `aria-selected` marks the current one. */
export const segmentTrack = 'inline-flex h-8 shrink-0 items-center gap-0.5 rounded-[9px] border border-border bg-surface-2 p-0.5'
export const segmentItem = `inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted aria-pressed:bg-surface-4 aria-pressed:font-semibold aria-selected:bg-surface-4 aria-selected:font-semibold ${focusRing}`
