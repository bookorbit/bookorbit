/**
 * The index a radio group's arrow, Home and End keys move to, wrapping at both ends, or null
 * when the key is not one a radio group handles.
 */
export function nextRovingIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  const current = index < 0 ? 0 : index
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
