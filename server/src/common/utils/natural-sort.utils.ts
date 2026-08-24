export function naturalCompare(a: string, b: string): number {
  const numericRun = /(\d+)/;
  const aParts = a.split(numericRun);
  const bParts = b.split(numericRun);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] ?? '';
    const bPart = bParts[i] ?? '';

    if (/^\d+$/.test(aPart) && /^\d+$/.test(bPart)) {
      const difference = Number.parseInt(aPart, 10) - Number.parseInt(bPart, 10);
      if (difference !== 0) return difference;
    } else {
      const difference = aPart.localeCompare(bPart);
      if (difference !== 0) return difference;
    }
  }

  return 0;
}
