export const APP_TITLE = 'BookOrbit'

export function formatPageTitle(leaf: string | null | undefined): string {
  const trimmed = (leaf ?? '').trim()
  if (!trimmed) return APP_TITLE
  return `${trimmed} · ${APP_TITLE}`
}
