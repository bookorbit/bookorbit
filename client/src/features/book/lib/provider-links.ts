export function lubimyczytacBookUrl(id: string): string {
  const value = String(id).trim()
  // New data stores the canonical "id/slug" path. lubimyczytac.pl 404s on a slug-less id,
  // so legacy bare-numeric ids get a placeholder slug segment to keep the link valid.
  const path = value.includes('/') ? value : `${value}/-`
  return `https://lubimyczytac.pl/ksiazka/${path.split('/').map(encodeURIComponent).join('/')}`
}
