<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import ActivateLink from '@/components/ActivateLink.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineOptions({ inheritAttrs: false })

const props = defineProps<{ text: string; to?: RouteLocationRaw | null; as?: 'p'; lines?: 1 | 2 }>()
const emit = defineEmits<{ activate: [event: MouseEvent] }>()

const label = useTemplateRef<HTMLSpanElement>('label')
const open = ref(false)
const focusClass = 'rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const actionClass = `block cursor-pointer appearance-none border-0 bg-transparent p-0 text-start hover:underline ${focusClass}`
const textClass = computed(() => (props.lines === 2 ? 'line-clamp-2' : 'block truncate'))

function handleOpenChange(requestedOpen: boolean) {
  const element = label.value
  open.value = requestedOpen && !!element && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)
}

function handleActivate(event: MouseEvent) {
  emit('activate', event)
}
</script>

<template>
  <Tooltip :open="open" ignore-non-keyboard-focus @update:open="handleOpenChange">
    <TooltipTrigger as-child>
      <p v-if="as === 'p'" v-bind="$attrs" :class="focusClass" tabindex="0">
        <span ref="label" :class="textClass">{{ text }}</span>
      </p>
      <ActivateLink v-else-if="to" v-bind="$attrs" :to="to" :class="actionClass" @activate="handleActivate">
        <span ref="label" :class="textClass">{{ text }}</span>
      </ActivateLink>
      <button v-else v-bind="$attrs" type="button" :class="actionClass" @click.stop="handleActivate">
        <span ref="label" :class="textClass">{{ text }}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent class="max-w-[min(24rem,calc(100vw-1rem))] wrap-anywhere motion-reduce:animate-none">{{ text }}</TooltipContent>
  </Tooltip>
</template>
