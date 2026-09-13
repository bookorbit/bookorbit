import { dirname } from 'path';

export function scanStateInvalidationPaths(folderPath: string): string[] {
  const paths = new Set<string>([folderPath]);
  let current = dirname(folderPath);

  while (!paths.has(current)) {
    paths.add(current);
    current = dirname(current);
  }

  return [...paths];
}
