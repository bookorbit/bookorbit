<script setup lang="ts">
import { ref, useId } from 'vue'
import { ChevronDown } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    title: string
    /** Short count or status beside the title, readable while the section is collapsed. */
    summary?: string | null
    defaultOpen?: boolean
  }>(),
  { summary: null, defaultOpen: true },
)

const open = ref(props.defaultOpen)
const panelId = `merge-section-${useId()}`

function toggle(): void {
  open.value = !open.value
}
</script>

<template>
  <section class="rounded-lg border border-border">
    <h4 class="m-0">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-expanded="open"
        :aria-controls="panelId"
        @click="toggle"
      >
        <span class="min-w-0 flex-1">{{ title }}</span>
        <span v-if="summary" class="shrink-0 text-xs font-medium text-muted-foreground">{{ summary }}</span>
        <ChevronDown
          :size="16"
          class="shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none"
          :class="open ? 'rotate-180' : undefined"
          aria-hidden="true"
        />
      </button>
    </h4>
    <div v-show="open" :id="panelId" class="space-y-3 border-t border-border px-3 py-3">
      <slot />
    </div>
  </section>
</template>
