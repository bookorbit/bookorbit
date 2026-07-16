export const RESOLVED_THEME_IDS = ["light", "dark"] as const;
export type ResolvedTheme = (typeof RESOLVED_THEME_IDS)[number];

export const THEME_IDS = [...RESOLVED_THEME_IDS, "system"] as const;
export type Theme = (typeof THEME_IDS)[number];

export const ACCENT_IDS = [
  "grey",
  "rose",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
  "pink",
  "white",
  "coral",
  "peach",
  "butter",
  "lemon",
  "celadon",
  "sage",
  "mint",
  "seafoam",
  "powder",
  "mist",
  "periwinkle",
  "wisteria",
  "lavender",
  "orchid",
  "blush",
] as const;
export type Accent = (typeof ACCENT_IDS)[number];

export const RADIUS_IDS = ["sharp", "default", "rounded", "pill"] as const;
export type Radius = (typeof RADIUS_IDS)[number];

export const BACKGROUND_IDS = [
  "none",
  "dots",
  "cross",
  "terminal",
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

export interface ThemePreferences {
  theme: Theme;
  accent: Accent;
  radius: Radius;
  background: Background;
  brightness: number;
}
