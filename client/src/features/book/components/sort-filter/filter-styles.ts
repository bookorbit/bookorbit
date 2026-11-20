const focusRing = 'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none'

/** A full-width row in a panel list: a radio choice, a menu entry, an active filter. */
export const choiceRow = `group flex min-h-8 w-full items-center gap-[9px] rounded-[calc(var(--radius)-4px)] px-2 text-start text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${focusRing} max-sm:min-h-[42px] max-sm:text-[14.5px]`

/** The round mark of a radio row; its row's `aria-checked` fills it. */
export const radioMark =
  'grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] border-input bg-background group-aria-checked:border-primary group-aria-checked:shadow-[inset_0_0_0_3.5px_var(--primary)]'

export const fieldInput = `h-[30px] min-w-0 rounded-[calc(var(--radius)-3px)] border border-input bg-background px-[9px] text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/55 focus:ring-[3px] focus:ring-primary/15 max-sm:h-[38px] max-sm:text-[15px]`

export const unitText = 'shrink-0 text-xs whitespace-nowrap text-muted-foreground'

/** A pill choice, such as a quick pick or a rating provider; `aria-pressed` marks the picked one. */
export const choiceChip = `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted aria-pressed:border-primary/45 aria-pressed:bg-primary/12 aria-pressed:font-semibold aria-pressed:text-primary ${focusRing}`

/** A borderless text button inside a panel: an operator, a field, "Add filter". */
export const ghostButton = `inline-flex h-7 shrink-0 items-center gap-[5px] rounded-[calc(var(--radius)-4px)] px-2 text-[12.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted ${focusRing}`

export const iconButton = `inline-grid size-[26px] shrink-0 place-items-center rounded-[calc(var(--radius)-4px)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${focusRing}`

export const primaryButton = `inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-3px)] border border-primary bg-primary px-3 text-[12.5px] font-semibold whitespace-nowrap text-primary-foreground transition-[filter] hover:brightness-105 ${focusRing} max-sm:h-[38px] max-sm:px-4 max-sm:text-[14px]`

export const sectionLabel = 'px-2 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase'
