<script setup lang="ts">
import { computed } from 'vue'
import { getProviderColor } from '@/lib/provider-colors'
import { providerIconPathSafe } from '@/features/book/lib/provider-icons'

const props = defineProps<{
  providerKey: string
  label: string
  enabled: boolean
}>()

const iconPath = computed(() => providerIconPathSafe(props.providerKey))

/**
 * Sources without a shipped icon fall back to their capitals: AudNexus reads AN,
 * ComicVine reads CV. Brand colour still carries the identity.
 */
const monogram = computed(() => {
  const capitals = props.label.match(/\p{Lu}/gu)
  if (capitals && capitals.length >= 2) return capitals.slice(0, 2).join('')
  return props.label.slice(0, 2).toUpperCase()
})
</script>

<template>
  <span
    class="grid size-8.5 shrink-0 place-items-center rounded-lg"
    :class="enabled ? 'provider-chip' : 'bg-foreground/6 ring-1 ring-border'"
    :style="enabled ? { '--provider-color': getProviderColor(providerKey) } : undefined"
    aria-hidden="true"
  >
    <img
      v-if="iconPath"
      :src="iconPath"
      alt=""
      class="size-4.5 object-contain transition-[filter,opacity]"
      :class="enabled ? '' : 'opacity-70 grayscale'"
    />
    <span v-else class="text-[11px] font-bold leading-none tracking-tight" :class="enabled ? '' : 'text-muted-foreground'">
      {{ monogram }}
    </span>
  </span>
</template>
