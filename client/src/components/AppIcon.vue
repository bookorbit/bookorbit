<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { customIconSlugFromValue, customIconSvgUrl } from '@bookorbit/types'
import LucideSymbolIcon from '@/components/LucideSymbolIcon.vue'
import { useCustomIcons } from '@/features/custom-icons/composables/useCustomIcons'
import { lucideIconHref, resolveLucideIconFile } from '@/lib/lucide-icons'

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
const iconFile = computed(() => (customSlug.value ? null : resolveLucideIconFile(props.icon)))
const fallbackComponent = computed(() => (props.fallback && typeof props.fallback !== 'string' ? props.fallback : null))
const lucideFile = computed(() => {
  if (iconFile.value) return iconFile.value
  return typeof props.fallback === 'string' ? resolveLucideIconFile(props.fallback) : null
})
const lucideHref = computed(() => (lucideFile.value ? lucideIconHref(lucideFile.value) : ''))
const customStyle = computed(() => {
  if (!customSlug.value) return undefined
  // Use the catalog svgUrl (which includes ?v=hash) when the icon is loaded for immutable caching.
  // Fall back to the plain URL for icons not yet in the catalog.
  const catalogEntry = findCustomIconByValue(props.icon)
  const url = `url("${catalogEntry?.svgUrl ?? customIconSvgUrl(customSlug.value)}") center / contain no-repeat`
  return { width: `${props.size}px`, height: `${props.size}px`, WebkitMask: url, mask: url }
})
</script>

<template>
  <span v-if="customSlug" aria-hidden="true" class="inline-block shrink-0 bg-current" :class="$attrs.class as never" :style="customStyle" />
  <LucideSymbolIcon v-else-if="iconFile" :file="iconFile" :href="lucideHref" :size="size" :class="$attrs.class as never" />
  <component :is="fallbackComponent" v-else-if="fallbackComponent" :size="size" :class="$attrs.class as never" />
  <LucideSymbolIcon v-else-if="lucideFile" :file="lucideFile" :href="lucideHref" :size="size" :class="$attrs.class as never" />
</template>
