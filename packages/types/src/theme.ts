export const RESOLVED_THEME_IDS = ["light", "dark"] as const;
export type ResolvedTheme = (typeof RESOLVED_THEME_IDS)[number];

export const THEME_IDS = [...RESOLVED_THEME_IDS, "system"] as const;
export type Theme = (typeof THEME_IDS)[number];

export const ACCENT_IDS = [
  "grey",
  "scarlet",
  "vermilion",
  "rose",
  "copper",
  "orange",
  "chartreuse",
  "marigold",
  "wasabi",
  "amber",
  "malachite",
  "yellow",
  "viridian",
  "turquoise",
  "lime",
  "green",
  "acid-green",
  "emerald",
  "teal",
  "electric-blue",
  "cyan",
  "jade",
  "ultramarine",
  "iris",
  "purple",
  "blue",
  "indigo",
  "violet",
  "amethyst",
  "fuchsia",
  "raspberry",
  "pink",
  "white",
  "rosewater",
  "salmon",
  "coral",
  "sand",
  "peach",
  "pear",
  "flax",
  "sprout",
  "butter",
  "aloe",
  "lemon",
  "foam",
  "aqua",
  "celadon",
  "sage",
  "pistachio",
  "mint",
  "seafoam",
  "baby-blue",
  "powder",
  "sea-glass",
  "bluebell",
  "cornflower",
  "thistle",
  "periwinkle",
  "wisteria",
  "lavender",
  "mauve",
  "orchid",
  "rose-quartz",
  "blush",
] as const;
export type Accent = (typeof ACCENT_IDS)[number];

export const RADIUS_IDS = ["sharp", "default", "rounded", "pill"] as const;
export type Radius = (typeof RADIUS_IDS)[number];

export const BACKGROUND_IDS = [
  "none",
  "dots",
  "cross",
  "millimeter",
  "blueprint",
  "brushed",
  "scanlines",
  "carbon",
  "vinyl",
  "perforated",
  "aurora",
  "horizon",
  "glow",
  "mesh",
  "elevation",
  "prism",
  "spectrum",
  "spectrum-x",
  "spectrum-plus",
  "eclipse",
] as const;
export type Background = (typeof BACKGROUND_IDS)[number];

/** Shell surface translucency, in percent. The floor keeps the sidebar and header
 *  readable over the busiest background patterns. */
export const SURFACE_OPACITY_MIN = 80;
export const SURFACE_OPACITY_MAX = 100;
export const SURFACE_OPACITY_DEFAULT = 92;

export interface ThemePreferences {
  theme: Theme;
  accent: Accent;
  radius: Radius;
  background: Background;
  brightness: number;
  /** Optional so a client that sends it stays valid against a server that predates it. */
  surfaceOpacity?: number;
}
