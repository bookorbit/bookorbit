import { ANNOTATION_COLOR_FILTER_OPTIONS, ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'

export interface HubChip {
  id: string
  label: string
  swatch?: string
}

export interface HubChipState {
  colors: string[]
  styleFilter: string
  originFilter: string
  dateFrom: string
  dateTo: string
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/**
 * The hub's own chip builder. `buildFilterChips` composes English label fragments and is
 * still what the book tab renders; this one returns finished translated labels so the hub
 * never concatenates a sentence out of pieces.
 */
export function buildHubChips(state: HubChipState, t: Translate, formatDay: (value: string) => string): HubChip[] {
  const chips: HubChip[] = []

  for (const hex of state.colors) {
    const known = ANNOTATION_HIGHLIGHT_COLORS.find((color) => color.hex === hex)
    const fallback = ANNOTATION_COLOR_FILTER_OPTIONS.find((color) => color.hex === hex)
    chips.push({
      id: `color:${hex}`,
      label: known ? t(`annotations.colors.${known.name}`) : ((fallback as { label?: string } | undefined)?.label ?? hex),
      swatch: hex,
    })
  }

  if (state.styleFilter && state.styleFilter !== 'all') {
    const key = state.styleFilter === 'strikethrough' ? 'strike' : state.styleFilter === 'squiggly' ? 'squiggle' : state.styleFilter
    chips.push({ id: 'style', label: t(`annotations.styles.${key}`) })
  }

  if (state.originFilter && state.originFilter !== 'all') {
    chips.push({ id: 'origin', label: t(`annotations.sources.${state.originFilter}`) })
  }

  if (state.dateFrom || state.dateTo) {
    const label =
      state.dateFrom && state.dateTo
        ? t('annotations.hub.chips.dateBetween', { from: formatDay(state.dateFrom), to: formatDay(state.dateTo) })
        : state.dateFrom
          ? t('annotations.hub.chips.dateFrom', { from: formatDay(state.dateFrom) })
          : t('annotations.hub.chips.dateUntil', { to: formatDay(state.dateTo) })
    chips.push({ id: 'date', label })
  }

  return chips
}
