export function isSemverTag(value: string | null | undefined): boolean {
  return !!value && /^v\d+\.\d+\.\d+/.test(value.trim())
}

export function parseSemver(value: string): [number, number, number] | null {
  const match = value
    .trim()
    .replace(/^v/, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isNewer(candidate: string, baseline: string): boolean {
  const a = parseSemver(candidate)
  const b = parseSemver(baseline)
  if (!a || !b) return false
  if (a[0] !== b[0]) return a[0] > b[0]
  if (a[1] !== b[1]) return a[1] > b[1]
  return a[2] > b[2]
}

/** Mirror of the server allowlist: only render GitHub-hosted attachment images. */
export function isAllowedImageHost(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (host === 'github.com') return u.pathname.startsWith('/user-attachments/')
    return host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

/** Lucide icon names are PascalCase; reject anything else so we never resolve a non-icon export. */
export function isIconNameShape(name: string | null | undefined): boolean {
  return !!name && /^[A-Z][A-Za-z0-9]*$/.test(name)
}

export function formatReleaseDate(date: string | null): string {
  if (!date) return ''
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatDate(parsed, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function shouldShowPopup(opts: {
  hasUnseen: boolean
  popupEnabled: boolean
  dismissedThisSession: boolean
  routeName: string | null | undefined
  alreadyOpen: boolean
}): boolean {
  if (opts.alreadyOpen) return false
  if (!opts.hasUnseen || !opts.popupEnabled || opts.dismissedThisSession) return false
  return opts.routeName !== 'reader'
}
import { formatDate } from '@/i18n/formatters'
