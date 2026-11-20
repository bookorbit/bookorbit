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

/**
 * Arrow, Home and End keys for a `role="radiogroup"` of buttons: checks the radio the key moves
 * to and focuses it. Keys pressed in anything else inside the group, such as an input, pass through.
 */
export function handleRadioGroupKeydown(event: KeyboardEvent) {
  const group = event.currentTarget as HTMLElement | null
  const from = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="radio"]')
  if (!group || !from) return
  const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
  const next = nextRovingIndex(event.key, radios.indexOf(from), radios.length)
  if (next === null) return
  event.preventDefault()
  radios[next]!.click()
  radios[next]!.focus()
}
