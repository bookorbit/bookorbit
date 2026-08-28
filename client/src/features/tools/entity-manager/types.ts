export const ENTITY_ROW_DENSITIES = ['comfortable', 'compact'] as const

export type EntityRowDensity = (typeof ENTITY_ROW_DENSITIES)[number]

export const ENTITY_PAGE_SIZES = [25, 50, 100] as const
