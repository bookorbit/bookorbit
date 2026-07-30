/**
 * Categorical pill styles for admin tables. Colours resolve from per-theme tuned
 * tokens rather than the raw Tailwind palette, so they retune between light and
 * dark instead of needing hand-written `dark:` overrides.
 */
export const STATUS_PILL_TONES = ['success', 'warning', 'danger', 'info', 'accent', 'neutral'] as const

export type StatusPillTone = (typeof STATUS_PILL_TONES)[number]

const TONE_CLASSES: Record<StatusPillTone, string> = {
  success: 'border-[var(--pill-success)]/40 bg-[var(--pill-success)]/10 text-[var(--pill-success)]',
  warning: 'border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 text-[var(--pill-warning)]',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
  info: 'border-[var(--pill-info)]/40 bg-[var(--pill-info)]/10 text-[var(--pill-info)]',
  accent: 'border-primary/40 bg-primary/10 text-primary',
  neutral: 'border-border bg-muted text-muted-foreground',
}

export function statusPillClass(tone: StatusPillTone): string {
  return TONE_CLASSES[tone]
}
