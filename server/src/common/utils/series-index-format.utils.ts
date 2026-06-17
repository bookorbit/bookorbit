export function formatSeriesIndex(value: number | null): string | null {
  if (value == null) return null;

  const [whole, fraction] = String(value).split('.');
  const padded = whole.padStart(2, '0');

  return fraction ? `${padded}.${fraction}` : padded;
}
