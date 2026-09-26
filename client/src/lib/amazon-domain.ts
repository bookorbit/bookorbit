export const AMAZON_DOMAINS = [
  'amazon.com',
  'amazon.co.uk',
  'amazon.de',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.ca',
  'amazon.com.au',
  'amazon.co.jp',
  'amazon.in',
  'amazon.com.br',
  'amazon.com.mx',
  'amazon.nl',
  'amazon.se',
  'amazon.pl',
  'amazon.sg',
  'amazon.ae',
  'amazon.sa',
  'amazon.tr',
] as const

export function normalizeAmazonDomain(value: string): string {
  const normalized = value.trim().toLowerCase()
  return AMAZON_DOMAINS.some((domain) => domain === normalized) ? normalized : 'amazon.com'
}
