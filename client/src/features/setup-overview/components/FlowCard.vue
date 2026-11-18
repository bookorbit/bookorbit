<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, CircleCheck, TriangleAlert } from '@lucide/vue'
import type { SetupFlowCard } from '@bookorbit/types'
import { RouterLink } from 'vue-router'

import { setupIcon } from '../lib/icons'
import { FLOW_HUE } from '../lib/palette'
import { useSetupText } from '../lib/text'
import FlowFan from './FlowFan.vue'
import FlowTable from './FlowTable.vue'
import FlowTrack from './FlowTrack.vue'

const props = defineProps<{ card: SetupFlowCard }>()

const text = useSetupText()

const hue = computed(() => FLOW_HUE[props.card.id])
const cardIcon = computed(() => setupIcon(props.card.icon))
const STATE_CLASS: Record<string, string> = {
  ok: 'border-success/40 bg-success/10 text-success',
  attention: 'border-warning/40 bg-warning/10 text-warning',
  off: 'border-border bg-muted text-muted-foreground',
}
</script>

<template>
  <section class="relative overflow-hidden rounded-xl border border-border bg-card" :style="{ '--hue': hue }">
    <span
      class="pointer-events-none absolute inset-x-0 top-0 h-0.5"
      :style="{ background: `linear-gradient(90deg, ${hue}, color-mix(in oklch, ${hue} 20%, transparent) 55%, transparent)`, opacity: 0.5 }"
      aria-hidden="true"
    />

    <div class="flex items-start gap-2.5 px-4 pt-3.5 pb-2.5">
      <span
        class="grid size-7 shrink-0 place-items-center rounded-lg"
        :style="{ background: `color-mix(in oklch, ${hue} 14%, transparent)`, color: hue }"
      >
        <component :is="cardIcon" v-if="cardIcon" :size="15" aria-hidden="true" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="text-[13.5px] font-semibold text-foreground">{{ text(card.title) }}</h3>
        <p class="mt-0.5 text-xs text-foreground">{{ text(card.summary) }}</p>
      </div>
      <span
        class="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap"
        :class="STATE_CLASS[card.state]"
      >
        <TriangleAlert v-if="card.state === 'attention'" :size="11" aria-hidden="true" />
        <CircleCheck v-else-if="card.state === 'ok'" :size="11" aria-hidden="true" />
        {{ text(card.stateLabel) }}
      </span>
    </div>

    <FlowFan v-if="card.shape === 'fan'" :flow="card.id" :steps="card.steps" :label="text(card.summary)" />
    <FlowTrack v-else :flow="card.id" :steps="card.steps" :branch="card.branch" :label="text(card.summary)" />

    <div v-if="card.facts.length" class="flex flex-wrap gap-1.5 px-4 pb-3.5">
      <span
        v-for="(fact, i) in card.facts"
        :key="i"
        class="inline-flex h-6 items-center rounded-md border px-2.5 text-xs font-medium text-foreground"
        :style="{ borderColor: `color-mix(in oklch, ${hue} 28%, var(--border))`, background: `color-mix(in oklch, ${hue} 7%, transparent)` }"
      >
        {{ text(fact) }}
      </span>
    </div>

    <FlowTable v-if="card.table" :table="card.table" />

    <div
      v-for="(warning, i) in card.warnings"
      :key="`${i}-${warning.code}`"
      class="flex items-start gap-2 border-t border-border bg-warning/10 px-4 py-3 text-xs text-foreground"
    >
      <TriangleAlert :size="13" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <b v-if="warning.subject" class="font-semibold">{{ warning.subject }}</b>
        {{ text(warning.detail) }}
      </span>
      <RouterLink
        v-if="warning.url"
        :to="warning.url"
        class="shrink-0 rounded-xs font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {{ text(warning.fix) }}
      </RouterLink>
    </div>

    <div v-if="card.links.length" class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-border px-4 py-2.5">
      <RouterLink
        v-for="link in card.links"
        :key="link.url"
        :to="link.url"
        class="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      >
        <component :is="setupIcon(link.icon)" v-if="setupIcon(link.icon)" :size="13" :style="{ color: hue }" aria-hidden="true" />
        {{ text(link.label) }}
        <ChevronRight :size="12" aria-hidden="true" />
      </RouterLink>
    </div>
  </section>
</template>
