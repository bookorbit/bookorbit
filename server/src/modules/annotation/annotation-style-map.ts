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

// Hex values mirror KOReader's BlitBuffer.HIGHLIGHT_COLORS; gray has no entry there
// (it renders via dimming) so a neutral mid-gray represents it on the web.
export const KOREADER_COLOR_HEX: Record<string, string> = {
  red: '#FF3300',
  orange: '#FF8800',
  yellow: '#FFFF33',
  green: '#00AA66',
  olive: '#88FF77',
  cyan: '#00FFEE',
  blue: '#0066FF',
  purple: '#EE00FF',
  gray: '#808080',
};

export const DEFAULT_KOREADER_COLOR_HEX = KOREADER_COLOR_HEX.yellow;

export function styleFromDrawer(drawer: string | null | undefined): AnnotationStyle {
  return DRAWER_TO_STYLE[drawer as KoreaderDrawer] ?? 'highlight';
}

export function drawerFromStyle(style: string | null | undefined): KoreaderDrawer {
  return STYLE_TO_DRAWER[style as AnnotationStyle] ?? 'lighten';
}

export function hexFromKoreaderColor(color: string | null | undefined): string {
  if (!color) return DEFAULT_KOREADER_COLOR_HEX;
  const named = KOREADER_COLOR_HEX[color.toLowerCase()];
  if (named) return named;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color.toUpperCase()}`;
  return DEFAULT_KOREADER_COLOR_HEX;
}

export function koreaderColorFromHex(hex: string | null | undefined): string {
  const rgb = parseHex(hex);
  if (!rgb) return 'yellow';
  // Raw RGB distance misjudges grayness in both directions (desaturated pinks land on
  // gray, near-blacks land on green), so saturation decides gray membership outright.
  const isChromatic = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) >= 40;
  if (!isChromatic) return 'gray';
  let best = 'yellow';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, namedHex] of Object.entries(KOREADER_COLOR_HEX)) {
    if (name === 'gray') continue;
    const named = parseHex(namedHex)!;
    const distance = (rgb.r - named.r) ** 2 + (rgb.g - named.g) ** 2 + (rgb.b - named.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
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
  const incoming = incomingColor.toLowerCase();
  if (KOREADER_COLOR_HEX[incoming]) {
    if (koreaderColorFromHex(currentHex) === incoming) return currentHex;
    return KOREADER_COLOR_HEX[incoming];
  }
  return hexFromKoreaderColor(incomingColor);
}

/** Kobo firmware's four fixed highlight colors. */
export const KOBO_COLOR_HEX: Record<string, string> = {
  yellow: '#F6F3B3',
  green: '#C6E09E',
  blue: '#B2E1E8',
  pink: '#E8AFCF',
};

export const DEFAULT_KOBO_COLOR_HEX = KOBO_COLOR_HEX.yellow;

const KOBO_TO_APP_COLOR: Record<string, string> = {
  '#F6F3B3': '#FACC15',
  '#C6E09E': '#4ADE80',
  '#B2E1E8': '#38BDF8',
  '#E8AFCF': '#F472B6',
};

const APP_TO_KOBO_COLOR: Record<string, string> = {
  '#FACC15': KOBO_COLOR_HEX.yellow,
  '#4ADE80': KOBO_COLOR_HEX.green,
  '#38BDF8': KOBO_COLOR_HEX.blue,
  '#F472B6': KOBO_COLOR_HEX.pink,
  '#FB923C': KOBO_COLOR_HEX.yellow,
};

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
