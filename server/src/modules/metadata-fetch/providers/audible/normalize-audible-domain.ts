export function normalizeAudibleDomain(value: string | undefined | null): string {
  let domain = (value ?? '').trim().toLowerCase();
  if (!domain) return 'com';

  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^api\.audible\./, '');
  domain = domain.replace(/^audible\./, '');
  domain = domain.replace(/\/.*$/, '');

  return domain || 'com';
}
