function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true

  const parts = host.split('.')
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [first = 0, second = 0] = parts.map(Number)
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    )
  }

  return host === '::1' || (host.includes(':') && (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)))
}

export function resolveResetLinkUrl(resetUrl: string, currentOrigin: string): string {
  try {
    const configured = new URL(resetUrl)
    const current = new URL(currentOrigin)
    if (!['http:', 'https:'].includes(configured.protocol) || !['http:', 'https:'].includes(current.protocol)) return resetUrl
    if (configured.protocol === 'https:' && current.protocol !== 'https:') return resetUrl
    // Keep the configured canonical URL unless it is local and the admin is using a public site.
    if (!isLocalHost(configured.hostname) || isLocalHost(current.hostname)) return resetUrl

    return `${current.origin}${configured.pathname}${configured.search}${configured.hash}`
  } catch {
    return resetUrl
  }
}
