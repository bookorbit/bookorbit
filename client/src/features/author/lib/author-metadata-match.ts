import { AuthorMetadataProviderKey, type AuthorMetadataCandidate } from '@bookorbit/types'

export type AuthorProviderReference = {
  provider: AuthorMetadataProviderKey
  providerId: string
}

const PROVIDER_LABELS: Record<AuthorMetadataProviderKey, string> = {
  [AuthorMetadataProviderKey.GOODREADS]: 'Goodreads',
  [AuthorMetadataProviderKey.AUDNEXUS]: 'Audnexus',
}

const GOODREADS_AUTHOR_URL = /goodreads\.com\/(?:[a-z]{2}\/)?author\/(?:show|list)\/(\d+)/i
const AUDIBLE_AUTHOR_URL = /audible\.[a-z.]+\/author\/(?:[^/?#]+\/)?(B[0-9A-Z]{9})(?=[/?#]|$)/i
const AUDNEXUS_AUTHOR_URL = /audnex\.us\/authors\/(B[0-9A-Z]{9})(?=[/?#]|$)/i
const BARE_GOODREADS_ID = /^\d+$/
const BARE_ASIN = /^B[0-9A-Z]{9}$/i

/** Brand names, so never translated. Unknown keys from a newer server show as they are. */
export function authorProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider as AuthorMetadataProviderKey] ?? provider
}

/**
 * Reads a pasted Goodreads author link or id, or an Audible author link or ASIN, as the provider
 * id the server looks up. Anything else is null, so the picker can say it does not recognise it.
 */
export function parseAuthorProviderReference(input: string): AuthorProviderReference | null {
  const value = input.trim()
  if (!value) return null

  const goodreads = value.match(GOODREADS_AUTHOR_URL)?.[1] ?? (BARE_GOODREADS_ID.test(value) ? value : null)
  if (goodreads) return { provider: AuthorMetadataProviderKey.GOODREADS, providerId: goodreads }

  const asin = value.match(AUDIBLE_AUTHOR_URL)?.[1] ?? value.match(AUDNEXUS_AUTHOR_URL)?.[1] ?? (BARE_ASIN.test(value) ? value : null)
  if (asin) return { provider: AuthorMetadataProviderKey.AUDNEXUS, providerId: asin.toUpperCase() }

  return null
}

/** The provider's own page for an author, the same link the server gives a candidate as `sourceUrl`. */
export function authorProviderSourceUrl(provider: string, providerId: string): string | null {
  const id = encodeURIComponent(providerId)
  if (provider === AuthorMetadataProviderKey.GOODREADS) return `https://www.goodreads.com/author/show/${id}`
  if (provider === AuthorMetadataProviderKey.AUDNEXUS) return `https://www.audible.com/author/${id}`
  return null
}

/** Birth and death years, from the full date when only that was given. */
export function candidateLifeYears(candidate: AuthorMetadataCandidate): { born: number | null; died: number | null } {
  return {
    born: candidate.birthYear ?? yearOf(candidate.birthDate),
    died: candidate.deathYear ?? yearOf(candidate.deathDate),
  }
}

function yearOf(date: string | undefined): number | null {
  const year = date ? Number(date.slice(0, 4)) : Number.NaN
  return Number.isFinite(year) ? year : null
}
