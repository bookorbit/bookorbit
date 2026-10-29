import { ref } from 'vue'

export interface ProviderAppearance {
  iconUrl: string | null
  color: string | null
}

const appearance = ref<Partial<Record<string, ProviderAppearance>>>({})

/**
 * External providers' icons and colours, which only the server knows. Every screen that loads a
 * provider list records them here, so the shared icon and colour helpers can answer for a provider
 * registered at runtime the way they answer for a built-in.
 */
export function registerProviderAppearance(providers: Iterable<{ key: string; iconUrl?: string | null; color?: string | null }>): void {
  const next = { ...appearance.value }
  for (const provider of providers) {
    next[provider.key] = { iconUrl: provider.iconUrl ?? null, color: provider.color ?? null }
  }
  appearance.value = next
}

export function providerAppearance(key: string): ProviderAppearance | undefined {
  return appearance.value[key]
}
