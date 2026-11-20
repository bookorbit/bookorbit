/**
 * A click the browser should handle itself when the target is a real link: Ctrl/Cmd, Shift and Alt
 * clicks and every non-primary button. Mirrors the guard vue-router's own RouterLink applies, so a
 * link that intercepts plain clicks never swallows "open in new tab".
 */
export function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

/**
 * The gestures that mean "open this in a new tab" on something that is not a native link: Ctrl/Cmd
 * plus click, or a middle-button click (which arrives as `auxclick`, never `click`).
 */
export function isNewTabClick(event: MouseEvent): boolean {
  if (event.shiftKey || event.altKey) return false
  if (event.button === 1) return true
  return event.button === 0 && (event.metaKey || event.ctrlKey)
}
