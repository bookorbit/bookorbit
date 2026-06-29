<script setup lang="ts">
import { computed } from 'vue'
import * as LucideIcons from '@lucide/vue'
import type { Component } from 'vue'
import { customIconSlugFromValue, customIconSvgUrl } from '@bookorbit/types'
import { useCustomIcons } from '@/features/custom-icons/composables/useCustomIcons'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    icon?: string | null
    fallback?: string | Component | null
    size?: number
  }>(),
  { size: 16, fallback: null },
)

const { findCustomIconByValue } = useCustomIcons()

const customSlug = computed(() => customIconSlugFromValue(props.icon))
const lucideComponent = computed(() => resolveLucide(props.icon) ?? resolveFallback())
const customStyle = computed(() => {
  if (!customSlug.value) return undefined
  // Use the catalog svgUrl (which includes ?v=hash) when the icon is loaded for immutable caching.
  // Fall back to the plain URL for icons not yet in the catalog.
  const catalogEntry = findCustomIconByValue(props.icon)
  const url = `url("${catalogEntry?.svgUrl ?? customIconSvgUrl(customSlug.value)}") center / contain no-repeat`
  return { width: `${props.size}px`, height: `${props.size}px`, WebkitMask: url, mask: url }
})

function resolveFallback(): Component | null {
  if (!props.fallback) return null
  if (typeof props.fallback !== 'string') return props.fallback
  return resolveLucide(props.fallback)
}

function resolveLucide(name: string | null | undefined): Component | null {
  if (!name || customIconSlugFromValue(name)) return null
  return ((LucideIcons as Record<string, unknown>)[name] as Component | undefined) ?? null
}
</script>

<template>
  <span v-if="customSlug" aria-hidden="true" class="inline-block shrink-0 bg-current" :class="$attrs.class as never" :style="customStyle" />
  <component :is="lucideComponent" v-else-if="lucideComponent" :size="size" :class="$attrs.class as never" />
</template>
