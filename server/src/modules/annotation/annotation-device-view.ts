import type { AnnotationDeviceContent } from '../../db/schema';
import { drawerFromStyle, hexFromKoreaderColor, koboColorFromHex, koreaderColorFromHex } from './annotation-style-map';
import { normalizeAnnotationNote } from './annotation-note.utils';

export type DeviceColorSpace = 'koreader' | 'kobo';

export type DeviceContentField = keyof AnnotationDeviceContent;

export const DEVICE_CONTENT_FIELDS: readonly DeviceContentField[] = ['note', 'color', 'style'];

/** How a device shows a canonical annotation: its palette color and, for KOReader, its drawer. */
export function canonicalDeviceView(
  space: DeviceColorSpace,
  annotation: { note: string | null; color: string; style: string },
): AnnotationDeviceContent {
  return {
    note: normalizeAnnotationNote(annotation.note),
    color: space === 'kobo' ? koboColorFromHex(annotation.color) : koreaderColorFromHex(annotation.color),
    style: space === 'kobo' ? null : drawerFromStyle(annotation.style),
  };
}

/** The same view of what a device uploaded. A field the device did not report is null. */
export function incomingDeviceView(
  space: DeviceColorSpace,
  incoming: { note?: string | null; color?: string | null; drawer?: string },
): AnnotationDeviceContent {
  const color = incoming.color
    ? space === 'kobo'
      ? koboColorFromHex(incoming.color)
      : koreaderColorFromHex(hexFromKoreaderColor(incoming.color))
    : null;
  return {
    note: normalizeAnnotationNote(incoming.note),
    color,
    style: space === 'kobo' ? null : (incoming.drawer ?? null),
  };
}

/** Whether a device copy matches canonical in every field it reports (a note is always reported). */
export function deviceHoldsView(device: AnnotationDeviceContent, canonical: AnnotationDeviceContent): boolean {
  return DEVICE_CONTENT_FIELDS.every((field) => (field !== 'note' && device[field] === null) || device[field] === canonical[field]);
}
