<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import { isModifiedClick } from '@/lib/click-modifiers'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    to: RouteLocationRaw
    /** Hands Ctrl/Cmd/Shift+click to `activate` too, for lists where those clicks already mean "select". */
    claimModifiers?: boolean
  }>(),
  { claimModifiers: false },
)

const emit = defineEmits<{
  activate: [event: MouseEvent]
}>()

/**
 * A real link whose plain click is the caller's own action, with the browser keeping every other
 * gesture: Ctrl/Cmd+click and middle-click open `to` in a new tab, and the context menu offers
 * "Open link in new tab". The click never reaches ancestors, so a card or row around the link does
 * not also run its own handler. Middle-click is never claimed.
 */
function handleClick(event: MouseEvent) {
  event.stopPropagation()
  if (isModifiedClick(event) && !props.claimModifiers) return
  event.preventDefault()
  emit('activate', event)
}
</script>

<template>
  <RouterLink v-slot="{ href }" :to="to" custom>
    <a v-bind="$attrs" :href="href" @click="handleClick" @auxclick.stop>
      <slot />
    </a>
  </RouterLink>
</template>
