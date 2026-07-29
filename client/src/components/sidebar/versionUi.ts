export type SidebarVersionUi = {
  currentLabel: string
  currentHref: string | null
  /** Drives the single update pill in the footer, replacing the old third wrapped link. */
  showUpdate: boolean
  updateVersionLabel: string
  updateHref: string
}

const GITHUB_RELEASES_BASE = 'https://github.com/bookorbit/bookorbit/releases'
const GITHUB_COMMIT_BASE = 'https://github.com/bookorbit/bookorbit/commit'

function isVersionTag(value: string): boolean {
  return /^v\d+\.\d+\.\d+$/.test(value)
}

function extractSha(value: string): string | null {
  const match = value.match(/^(?:sha-)?([0-9a-f]{7,40})$/i)
  return match ? (match[1] ?? null) : null
}

function normalizeVersionLabel(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  const sha = extractSha(normalized)
  if (sha) return `sha-${sha.slice(0, 12)}`
  return normalized
}

export function buildSidebarVersionUi(version: string, updateAvailable: boolean | null, latestVersion: string | null): SidebarVersionUi {
  const currentRaw = version.trim()
  const latestRaw = (latestVersion ?? '').trim()
  const currentIsTag = isVersionTag(currentRaw)
  const currentSha = extractSha(currentRaw)
  const currentLabelBase = normalizeVersionLabel(currentRaw)
  const showUpdate = Boolean(updateAvailable && latestRaw && currentLabelBase && currentIsTag)

  return {
    currentLabel: currentLabelBase,
    currentHref: currentIsTag ? `${GITHUB_RELEASES_BASE}/tag/${currentRaw}` : currentSha ? `${GITHUB_COMMIT_BASE}/${currentSha}` : null,
    showUpdate,
    updateVersionLabel: normalizeVersionLabel(latestRaw),
    updateHref: isVersionTag(latestRaw) ? `${GITHUB_RELEASES_BASE}/tag/${latestRaw}` : `${GITHUB_RELEASES_BASE}/latest`,
  }
}
