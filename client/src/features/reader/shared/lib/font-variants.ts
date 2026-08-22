import type { FontNamedInstance, FontVariant, UserFont } from '@bookorbit/types'
import { BUILT_IN_FONT_VARIANTS, compareFontVariants, isVariableFont } from '@bookorbit/types'

/** Translation keys for the standard weight names, keyed by the CSS weight they describe. */
export const FONT_WEIGHT_LABEL_KEYS: Record<number, string> = {
  100: 'settings.reader.fonts.weightThin',
  200: 'settings.reader.fonts.weightExtraLight',
  300: 'settings.reader.fonts.weightLight',
  400: 'settings.reader.fonts.weightRegular',
  500: 'settings.reader.fonts.weightMedium',
  600: 'settings.reader.fonts.weightSemiBold',
  700: 'settings.reader.fonts.weightBold',
  800: 'settings.reader.fonts.weightExtraBold',
  900: 'settings.reader.fonts.weightBlack',
}

/**
 * The styles one family offers.
 *
 * A static family offers whatever files were uploaded for it. A variable file offers the
 * instances its designer named, so a single upload can still present Light through Black.
 * A family can be both at once - a variable upright paired with a static italic is a
 * common way to ship a typeface - so the two are merged rather than chosen between.
 */
export function familyVariants(fonts: readonly UserFont[]): FontNamedInstance[] {
  const byKey = new Map<string, FontNamedInstance>()

  for (const font of fonts) {
    const defaultVariant: FontNamedInstance = { name: null, weight: font.weight, style: font.style }
    const offered: FontNamedInstance[] = isVariableFont(font) ? [defaultVariant, ...(font.instances ?? [])] : [defaultVariant]

    for (const variant of offered) {
      const key = variantKey(variant)
      const existing = byKey.get(key)
      if (!existing || (existing.name === null && variant.name !== null)) byKey.set(key, variant)
    }
  }

  return [...byKey.values()].sort(compareFontVariants)
}

/** The styles a built-in stack offers, in the same shape as an uploaded family's. */
export function builtInVariants(): FontNamedInstance[] {
  return BUILT_IN_FONT_VARIANTS.map((variant) => ({ ...variant, name: null }))
}

export function variantKey(variant: FontVariant): string {
  return `${variant.weight}:${variant.style}`
}

export function isSameVariant(a: FontVariant, b: FontVariant): boolean {
  return a.weight === b.weight && a.style === b.style
}

/**
 * Picks the variant to fall back to when the current one is not on offer, which happens
 * whenever the reader switches to a family that lacks it. Preferring the same style keeps
 * an italic selection italic across a switch; the nearest weight keeps a bold one bold.
 */
export function closestVariant(variants: readonly FontVariant[], target: FontVariant): FontVariant | null {
  if (variants.length === 0) return null

  const sameStyle = variants.filter((variant) => variant.style === target.style)
  const candidates = sameStyle.length > 0 ? sameStyle : variants

  return candidates.reduce((best, variant) => (Math.abs(variant.weight - target.weight) < Math.abs(best.weight - target.weight) ? variant : best))
}
