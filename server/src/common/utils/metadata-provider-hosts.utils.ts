const AMAZON_ORIGINS: Readonly<Record<string, string>> = {
  'amazon.com': 'https://www.amazon.com',
  'amazon.co.uk': 'https://www.amazon.co.uk',
  'amazon.de': 'https://www.amazon.de',
  'amazon.fr': 'https://www.amazon.fr',
  'amazon.it': 'https://www.amazon.it',
  'amazon.es': 'https://www.amazon.es',
  'amazon.ca': 'https://www.amazon.ca',
  'amazon.com.au': 'https://www.amazon.com.au',
  'amazon.co.jp': 'https://www.amazon.co.jp',
  'amazon.in': 'https://www.amazon.in',
  'amazon.com.br': 'https://www.amazon.com.br',
  'amazon.com.mx': 'https://www.amazon.com.mx',
  'amazon.nl': 'https://www.amazon.nl',
  'amazon.se': 'https://www.amazon.se',
  'amazon.pl': 'https://www.amazon.pl',
  'amazon.sg': 'https://www.amazon.sg',
  'amazon.ae': 'https://www.amazon.ae',
  'amazon.sa': 'https://www.amazon.sa',
  'amazon.tr': 'https://www.amazon.tr',
};

const AUDIBLE_API_ORIGINS: Readonly<Record<string, string>> = {
  com: 'https://api.audible.com',
  'co.uk': 'https://api.audible.co.uk',
  de: 'https://api.audible.de',
  fr: 'https://api.audible.fr',
  it: 'https://api.audible.it',
  es: 'https://api.audible.es',
  ca: 'https://api.audible.ca',
  'com.au': 'https://api.audible.com.au',
  'co.jp': 'https://api.audible.co.jp',
  in: 'https://api.audible.in',
};

const MAX_PROVIDER_DOMAIN_LENGTH = 256;

function normalizeProviderDomainInput(value: string | undefined | null): string {
  return typeof value === 'string' ? value.slice(0, MAX_PROVIDER_DOMAIN_LENGTH).trim().toLowerCase() : '';
}

export function normalizeAmazonDomain(value: string | undefined | null): string {
  const normalized = normalizeProviderDomainInput(value);
  return AMAZON_ORIGINS[normalized] ? normalized : 'amazon.com';
}

export function amazonOrigin(value: string | undefined | null): string {
  return AMAZON_ORIGINS[normalizeAmazonDomain(value)] ?? AMAZON_ORIGINS['amazon.com'];
}

export function normalizeAudibleDomain(value: string | undefined | null): string {
  let domain = normalizeProviderDomainInput(value);
  if (domain.startsWith('https://')) domain = domain.slice('https://'.length);
  else if (domain.startsWith('http://')) domain = domain.slice('http://'.length);

  if (domain.startsWith('api.audible.')) domain = domain.slice('api.audible.'.length);
  else if (domain.startsWith('audible.')) domain = domain.slice('audible.'.length);

  const pathStart = domain.indexOf('/');
  if (pathStart !== -1) domain = domain.slice(0, pathStart);
  return AUDIBLE_API_ORIGINS[domain] ? domain : 'com';
}

export function audibleApiOrigin(value: string | undefined | null): string {
  return AUDIBLE_API_ORIGINS[normalizeAudibleDomain(value)] ?? AUDIBLE_API_ORIGINS.com;
}
