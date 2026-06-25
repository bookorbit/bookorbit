export function isSemverNewer(candidate: string | null | undefined, current: string | null | undefined): boolean | null {
  const parsedCandidate = parseSemver(candidate);
  const parsedCurrent = parseSemver(current);
  if (!parsedCandidate || !parsedCurrent) return null;
  if (parsedCandidate[0] !== parsedCurrent[0]) return parsedCandidate[0] > parsedCurrent[0];
  if (parsedCandidate[1] !== parsedCurrent[1]) return parsedCandidate[1] > parsedCurrent[1];
  return parsedCandidate[2] > parsedCurrent[2];
}

function parseSemver(version: string | null | undefined): [number, number, number] | null {
  if (!version) return null;
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]!), Number(match[2]!), Number(match[3]!)];
}
