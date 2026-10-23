import type { Component } from 'vue'
import { Mail, Tablet, TabletSmartphone, UserRound } from '@lucide/vue'

export type DeviceType = 'kindle' | 'kobo' | 'other' | null

export interface DeviceLook {
  icon: Component
  /** A colour token, painted at 13% behind the icon. */
  color: string
  /** Key under `email.device`. */
  labelKey: string
}

const LOOKS: Record<'kindle' | 'kobo' | 'other' | 'none', DeviceLook> = {
  kindle: { icon: Tablet, color: 'var(--format-kindle)', labelKey: 'kindle' },
  kobo: { icon: Tablet, color: 'var(--format-ebook)', labelKey: 'kobo' },
  other: { icon: TabletSmartphone, color: 'var(--pill-format-mobi)', labelKey: 'otherShort' },
  none: { icon: UserRound, color: 'var(--muted-foreground)', labelKey: 'none' },
}

/** How a recipient is drawn. A send whose recipient is gone gets a plain envelope. */
export function deviceLook(deviceType: string | null | undefined, known = true): DeviceLook {
  if (!known) return { icon: Mail, color: 'var(--muted-foreground)', labelKey: 'none' }
  if (deviceType === 'kindle' || deviceType === 'kobo' || deviceType === 'other') return LOOKS[deviceType]
  return LOOKS.none
}
