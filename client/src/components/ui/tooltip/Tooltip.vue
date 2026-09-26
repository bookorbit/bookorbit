<script setup lang="ts">
import type { TooltipRootEmits, TooltipRootProps } from 'reka-ui'
import { injectTooltipProviderContext, TooltipRoot, useForwardPropsEmits } from 'reka-ui'
import TooltipProvider from './TooltipProvider.vue'

const props = defineProps<TooltipRootProps>()
const emits = defineEmits<TooltipRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)

// Every reka-ui tooltip part injects the provider context and throws when it is missing. App.vue
// wraps the whole application in one, so the only callers that land here are trees mounted outside
// it, which is what a component test does. Standing in a provider keeps those trees rendering
// instead of failing, and the app's own provider still wins wherever it is in scope.
const providerInScope = injectTooltipProviderContext(null) !== null
</script>

<template>
  <TooltipRoot v-if="providerInScope" v-slot="slotProps" data-slot="tooltip" v-bind="forwarded">
    <slot v-bind="slotProps" />
  </TooltipRoot>
  <TooltipProvider v-else>
    <TooltipRoot v-slot="slotProps" data-slot="tooltip" v-bind="forwarded">
      <slot v-bind="slotProps" />
    </TooltipRoot>
  </TooltipProvider>
</template>
