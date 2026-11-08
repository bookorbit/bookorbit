/**
 * The Lucide file a PascalCase icon name most likely lives in. The build records every name this
 * guess gets wrong (renamed icons, digit runs), so it only has to be deterministic, not complete.
 * Shared by the build plugin and the runtime resolver, which must agree on it exactly.
 */
export function guessLucideFileName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase()
}

/** Every Lucide icon is also exported as `<Name>Icon` and `Lucide<Name>`; the picker lists each name once. */
export function isLucidePickerName(name: string): boolean {
  return /^[A-Z]/.test(name) && !name.endsWith('Icon') && !name.startsWith('Lucide')
}
