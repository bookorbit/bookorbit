const GRAPHQL_INT_MAX = 2_147_483_647;

export function parseHardcoverBookId(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= GRAPHQL_INT_MAX ? id : null;
}
