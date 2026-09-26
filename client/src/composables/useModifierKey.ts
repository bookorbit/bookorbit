import { computed, type ComputedRef } from 'vue'

/**
 * Apple keyboards label the shortcut modifier differently from every other platform, so a hint
 * that hardcodes one of them is wrong for half the users. Keep the detection here so the label
 * cannot drift between the places that display it.
 */
export function useModifierKey(): { isMac: ComputedRef<boolean>; modifierKey: ComputedRef<string> } {
  const isMac = computed(() => typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent))
  return { isMac, modifierKey: computed(() => (isMac.value ? '⌘' : 'Ctrl')) }
}
