export function stripFragment(href: string): string {
  return href.split('#')[0]
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
