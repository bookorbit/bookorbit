import { DEFAULT_STYLE, STYLE_IDS, SURFACE_PALETTE_IDS, type Background, type Style, type SurfacePalette } from '@bookorbit/types'

export interface ThemeStyleDefinition {
  id: Style
  labelKey: string
  descriptionKey: string
  /** Pickers this style adds to the appearance controls. Everything else is shared by every style. */
  controls: {
    surfacePalette: boolean
  }
  /**
   * Shared settings this style fixes. While it is applied the pinned value is used and its control
   * is hidden; the user's own value stays stored for the styles that do not pin it.
   */
  pinned: {
    background?: Background
    brightness?: number
    surfaceOpacity?: number
  }
}

const STYLE_DEFINITIONS: Record<Style, Omit<ThemeStyleDefinition, 'id'>> = {
  bookorbit: {
    labelKey: 'settings.appearance.theme.style.bookorbit.label',
    descriptionKey: 'settings.appearance.theme.style.bookorbit.description',
    controls: { surfacePalette: false },
    pinned: {},
  },
  nostalgia: {
    labelKey: 'settings.appearance.theme.style.nostalgia.label',
    descriptionKey: 'settings.appearance.theme.style.nostalgia.description',
    controls: { surfacePalette: true },
    // No pattern behind the glow, solid panels, and no lift: the dark ladder in styles/nostalgia.css is the
    // classic ash ladder as is.
    pinned: { background: 'none', brightness: 0, surfaceOpacity: 100 },
  },
}

export const THEME_STYLES: readonly ThemeStyleDefinition[] = STYLE_IDS.map((id) => ({ id, ...STYLE_DEFINITIONS[id] }))

export function getThemeStyle(id: Style): ThemeStyleDefinition {
  return THEME_STYLES.find((style) => style.id === id) ?? getThemeStyle(DEFAULT_STYLE)
}

export interface AppearanceControls {
  surfacePalette: boolean
  background: boolean
  surfaceOpacity: boolean
  brightness: boolean
}

/** Which appearance pickers to render while `style` is selected. */
export function getAppearanceControls(style: Style): AppearanceControls {
  const definition = getThemeStyle(style)
  return {
    surfacePalette: definition.controls.surfacePalette,
    background: definition.pinned.background === undefined,
    surfaceOpacity: definition.pinned.surfaceOpacity === undefined,
    brightness: definition.pinned.brightness === undefined,
  }
}

export interface SurfacePaletteOption {
  id: SurfacePalette
  labelKey: string
}

export const SURFACE_PALETTES: readonly SurfacePaletteOption[] = SURFACE_PALETTE_IDS.map((id) => ({
  id,
  labelKey: `settings.appearance.theme.surfacePalette.palettes.${id}`,
}))

/**
 * Top-level routes that render outside the app shell. A style only dresses the shell, so these
 * always paint as BookOrbit. `public/theme-init.js` mirrors this list for the first paint; a spec
 * keeps the two and the router in step.
 */
export const STANDALONE_ROUTE_PREFIXES = [
  '/read/',
  '/login',
  '/register',
  '/setup',
  '/forgot-password',
  '/reset-password',
  '/oauth2-callback',
  '/magic',
] as const

export function isAppShellPath(path: string): boolean {
  return !STANDALONE_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
}
