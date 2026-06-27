import {
  ANNOTATION_HIGHLIGHT_COLORS,
  KOBO_HIGHLIGHT_COLORS,
  KOREADER_HIGHLIGHT_COLORS,
  type KoboHighlightColorName,
  type KoreaderHighlightColorName,
} from '@bookorbit/types';
import type { AnnotationStyle } from './annotation.constants';

export const KOREADER_DRAWERS = ['lighten', 'underscore', 'strikeout', 'invert'] as const;
export type KoreaderDrawer = (typeof KOREADER_DRAWERS)[number];

const DRAWER_TO_STYLE: Record<KoreaderDrawer, AnnotationStyle> = {
  lighten: 'highlight',
  underscore: 'underline',
  strikeout: 'strikethrough',
  invert: 'invert',
};

// squiggly has no KOReader equivalent and degrades to underscore on the device.
const STYLE_TO_DRAWER: Record<AnnotationStyle, KoreaderDrawer> = {
  highlight: 'lighten',
  underline: 'underscore',
  strikethrough: 'strikeout',
  squiggly: 'underscore',
  invert: 'invert',
};

type AnnotationHighlightColor = (typeof ANNOTATION_HIGHLIGHT_COLORS)[number];
type KoreaderHighlightColor = (typeof KOREADER_HIGHLIGHT_COLORS)[number];

const APP_COLOR_BY_HEX = Object.fromEntries(ANNOTATION_HIGHLIGHT_COLORS.map((color) => [color.hex, color])) as Record<
  string,
  AnnotationHighlightColor
>;
const KOREADER_BY_NAME = Object.fromEntries(KOREADER_HIGHLIGHT_COLORS.map((color) => [color.name, color])) as Record<string, KoreaderHighlightColor>;
const KOREADER_BY_HEX = Object.fromEntries(KOREADER_HIGHLIGHT_COLORS.map((color) => [color.hex, color])) as Record<string, KoreaderHighlightColor>;

// Hex values mirror KOReader's BlitBuffer.HIGHLIGHT_COLORS. Gray has no entry there
// because it renders through dimming, so a neutral mid-gray represents it here.
export const KOREADER_COLOR_HEX = Object.fromEntries(KOREADER_HIGHLIGHT_COLORS.map((color) => [color.name, color.hex])) as Record<
  KoreaderHighlightColorName,
  string
>;

export const DEFAULT_KOREADER_COLOR_HEX = KOREADER_BY_NAME.yellow.hex;
export const DEFAULT_ANNOTATION_COLOR_HEX = KOREADER_BY_NAME.yellow.appHex;

export function styleFromDrawer(drawer: string | null | undefined): AnnotationStyle {
  return DRAWER_TO_STYLE[drawer as KoreaderDrawer] ?? 'highlight';
}

export function drawerFromStyle(style: string | null | undefined): KoreaderDrawer {
  return STYLE_TO_DRAWER[style as AnnotationStyle] ?? 'lighten';
}

export function hexFromKoreaderColor(color: string | null | undefined): string {
  if (!color) return DEFAULT_ANNOTATION_COLOR_HEX;
  const named = KOREADER_BY_NAME[color.trim().toLowerCase()];
  if (named) return named.appHex;
  const normalized = normalizeHex(color);
  if (!normalized) return DEFAULT_ANNOTATION_COLOR_HEX;
  return KOREADER_BY_HEX[normalized]?.appHex ?? normalized;
}

export function koreaderColorFromHex(hex: string | null | undefined): string {
  const normalized = normalizeHex(hex);
  if (!normalized) return 'yellow';
  const appColor = APP_COLOR_BY_HEX[normalized];
  if (appColor) return appColor.koreaderFallback;
  const exactKoreaderColor = KOREADER_BY_HEX[normalized];
  if (exactKoreaderColor) return exactKoreaderColor.name;

  const rgb = parseHex(normalized);
  if (!rgb) return 'yellow';
  // Raw RGB distance misjudges grayness in both directions (desaturated pinks land on
  // gray, near-blacks land on green), so saturation decides gray membership outright.
  const isChromatic = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) >= 40;
  if (!isChromatic) return 'gray';
  let best = 'yellow';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of KOREADER_HIGHLIGHT_COLORS) {
    if (color.name === 'gray') continue;
    const named = parseHex(color.hex)!;
    const distance = (rgb.r - named.r) ** 2 + (rgb.g - named.g) ** 2 + (rgb.b - named.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color.name;
    }
  }
  return best;
}

/**
 * Round-trip stability: a device echoing back the projected view of a canonical field must
 * not overwrite it (canonical `squiggly` survives a device echo of `underscore`). Only a
 * genuinely different device value up-maps and replaces the canonical one.
 */
export function applyDeviceStyle(currentStyle: AnnotationStyle, incomingDrawer: string | null | undefined): AnnotationStyle {
  if (!incomingDrawer) return currentStyle;
  if (drawerFromStyle(currentStyle) === incomingDrawer) return currentStyle;
  return styleFromDrawer(incomingDrawer);
}

export function applyDeviceColor(currentHex: string, incomingColor: string | null | undefined): string {
  if (!incomingColor) return currentHex;
  const incoming = incomingColor.trim().toLowerCase();
  const named = KOREADER_BY_NAME[incoming];
  if (named) {
    if (koreaderColorFromHex(currentHex) === incoming) return currentHex;
    return named.appHex;
  }
  return hexFromKoreaderColor(incomingColor);
}

/** Kobo firmware's four fixed highlight colors. */
export const KOBO_COLOR_HEX = Object.fromEntries(KOBO_HIGHLIGHT_COLORS.map((color) => [color.name, color.hex])) as Record<
  KoboHighlightColorName,
  string
>;

export const DEFAULT_KOBO_COLOR_HEX = KOBO_COLOR_HEX.yellow;

const KOBO_TO_APP_COLOR: Record<string, string> = {
  [KOBO_COLOR_HEX.yellow]: '#FACC15',
  [KOBO_COLOR_HEX.green]: '#4ADE80',
  [KOBO_COLOR_HEX.blue]: '#38BDF8',
  [KOBO_COLOR_HEX.pink]: '#F472B6',
};

const APP_TO_KOBO_COLOR = Object.fromEntries([
  ...ANNOTATION_HIGHLIGHT_COLORS.map((color) => [color.hex, KOBO_COLOR_HEX[color.koboFallback]]),
  ...KOREADER_HIGHLIGHT_COLORS.map((color) => [color.hex, KOBO_COLOR_HEX[color.koboFallback]]),
]) as Record<string, string>;

export function hexFromKoboColor(color: string | null | undefined): string {
  const normalized = normalizeHex(color);
  if (!normalized) return KOBO_TO_APP_COLOR[DEFAULT_KOBO_COLOR_HEX];
  return KOBO_TO_APP_COLOR[normalized] ?? KOBO_TO_APP_COLOR[koboColorFromHex(normalized)];
}

export function koboColorFromHex(hex: string | null | undefined): string {
  const normalized = normalizeHex(hex);
  if (!normalized) return DEFAULT_KOBO_COLOR_HEX;
  if (Object.values(KOBO_COLOR_HEX).includes(normalized)) return normalized;
  const direct = APP_TO_KOBO_COLOR[normalized];
  if (direct) return direct;
  const rgb = parseHex(normalized);
  if (!rgb) return DEFAULT_KOBO_COLOR_HEX;
  let best = DEFAULT_KOBO_COLOR_HEX;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const koboHex of Object.values(KOBO_COLOR_HEX)) {
    const named = parseHex(koboHex)!;
    const distance = (rgb.r - named.r) ** 2 + (rgb.g - named.g) ** 2 + (rgb.b - named.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = koboHex;
    }
  }
  return best;
}

/** Same round-trip stability rule as applyDeviceColor, over Kobo's palette. */
export function applyKoboDeviceColor(currentHex: string, incomingKoboColor: string | null | undefined): string {
  const incoming = normalizeHex(incomingKoboColor);
  if (!incoming) return currentHex;
  if (koboColorFromHex(currentHex) === incoming) return currentHex;
  return hexFromKoboColor(incoming);
}

function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

function parseHex(hex: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}
