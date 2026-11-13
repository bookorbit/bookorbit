import type { Component } from 'vue'
import { MessagesSquare, Network, ScanLine } from '@lucide/vue'
import type { AiFeatureId, AiSlot } from '@bookorbit/types'

/**
 * The dense table the AI settings sections share. A row is a grid on desktop; below 768px it wraps
 * into two lines: the name and actions first, the details under them. The `after:` break forces
 * that second line, and `order` puts the actions before it.
 */
export const aiTable = {
  card: 'min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-xs',
  head: 'hidden items-center gap-x-4 border-b border-border bg-muted/40 px-4 py-[7px] text-[10px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase md:grid',
  list: 'divide-y divide-border',
  row: "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-[13px] leading-[18px] max-md:after:order-2 max-md:after:-mt-1.5 max-md:after:h-0 max-md:after:basis-full max-md:after:content-[''] md:grid md:min-h-[54px] md:gap-x-4 md:gap-y-0 md:px-4 md:py-2.5",
  rowOpen: 'bg-primary/6',
  main: 'min-w-0 flex-1',
  meta: 'min-w-0 max-md:order-3 max-md:text-xs max-md:text-muted-foreground',
  wide: 'min-w-0 max-md:order-3 max-md:basis-full',
  hideOnPhone: 'max-md:hidden',
  actions: 'flex items-center justify-end gap-0.5 max-md:order-2 max-md:ms-auto',
  num: 'text-end whitespace-nowrap tabular-nums max-md:text-start',
  name: 'truncate font-semibold text-foreground',
  sub: 'mt-px text-xs leading-4 text-muted-foreground',
  mono: 'font-mono text-[12.5px]',
  note: 'flex basis-full items-start gap-2 text-xs leading-4 max-md:order-4 md:col-span-full md:mt-1.5',
  noteIcon: 'mt-px size-3.5 shrink-0',
  link: 'ms-1 text-xs font-medium whitespace-nowrap text-primary underline-offset-2 hover:underline focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
  editor: 'border-t border-border bg-muted/28 p-3.5 md:p-4',
  foot: 'mt-3.5 flex flex-wrap items-center gap-2',
  footNote: 'text-xs leading-4 text-muted-foreground',
  status: 'flex min-w-0 items-center gap-[7px] text-xs leading-4',
  dot: 'size-2 shrink-0 rounded-full',
  chips: 'flex flex-wrap gap-1',
  chip: 'inline-flex h-5 items-center gap-[5px] rounded-full border border-border bg-surface-2 px-[7px] text-[11px] leading-[14px] font-medium whitespace-nowrap text-foreground',
  chipOptional:
    'inline-flex h-5 items-center gap-[5px] rounded-full border border-dashed border-border px-[7px] text-[11px] leading-[14px] font-medium whitespace-nowrap text-muted-foreground',
  chipDot: 'size-1.5 shrink-0 rounded-full',
} as const

/** Column widths per table, shared by its header and rows so the two line up. */
export const aiColumns = {
  providers: 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.45fr)_minmax(0,0.85fr)_104px]',
  models: 'md:grid-cols-[minmax(0,1.15fr)_minmax(0,1.45fr)_minmax(0,0.95fr)_minmax(0,1.05fr)_72px]',
  features: 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,0.8fr)_40px_40px]',
  spending: 'md:grid-cols-[minmax(0,1.35fr)_minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1.1fr)_40px]',
} as const

/** Each slot's colour, carried by a dot wherever the slot is named, so a slot reads the same in every table. */
export const SLOT_DOT: Record<AiSlot, string> = {
  fast: 'bg-[var(--pill-source-blue)]',
  careful: 'bg-[var(--pill-source-purple)]',
  vision: 'bg-[var(--pill-source-orange)]',
}

export function slotDotClass(slot: string): string {
  return (SLOT_DOT as Record<string, string>)[slot] ?? 'bg-muted-foreground'
}

export const FEATURE_ICONS: Record<AiFeatureId, Component> = {
  'story-guides': Network,
  'vision-scan': ScanLine,
  'reading-help': MessagesSquare,
}

/** Status dot colours, matching the status text beside them. */
export const STATUS_DOT = {
  ok: 'bg-success',
  error: 'bg-destructive',
  warning: 'bg-warning',
  idle: 'bg-muted-foreground',
} as const

export type AiStatusTone = keyof typeof STATUS_DOT
