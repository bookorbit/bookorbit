<script setup lang="ts">
import { ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, TriangleAlert } from '@lucide/vue'

import { Button } from '@/components/ui/button'

export interface AttentionItem {
  id: string
  tone: 'err' | 'warn'
  icon: Component
  /** An `email.attention.*` sentence; each slot is a value placed into it. */
  keypath: string
  slots: Record<string, { text: string; strong?: boolean }>
  detail: string
  /** Shown in a monospace run before the detail, for server output such as an error code. */
  detailCode?: string
  actionLabel: string
}

defineProps<{ items: AttentionItem[]; busyId?: string | null }>()
const emit = defineEmits<{ act: [item: AttentionItem] }>()

const { t } = useI18n()
const collapsed = ref(false)

function toggleCollapsed() {
  collapsed.value = !collapsed.value
}
/** Bound through a call so the locale scanner does not read `item.keypath` as a literal key. */
function sentenceOf(item: AttentionItem): string {
  return item.keypath
}
function handleAct(item: AttentionItem) {
  emit('act', item)
}
</script>

<template>
  <!-- The Users page's band: drawn only when something is wrong, each line with its one fix. -->
  <section
    aria-labelledby="email-attention-heading"
    class="@container overflow-hidden rounded-lg border border-[var(--pill-warning)]/35 bg-[color-mix(in_oklch,var(--pill-warning)_6%,var(--card))] shadow-xs"
  >
    <div class="flex items-center gap-3 px-4 py-2.5" :class="collapsed ? '' : 'border-b border-[var(--pill-warning)]/25'">
      <h3 id="email-attention-heading" class="flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-[var(--pill-warning)]">
        <TriangleAlert :size="15" class="shrink-0" aria-hidden="true" />
        {{ t('email.attention.title') }}
      </h3>
      <p class="text-xs tabular-nums text-muted-foreground">{{ t('email.attention.count', { count: items.length }) }}</p>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        class="ms-auto h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]"
        :aria-expanded="!collapsed"
        @click="toggleCollapsed"
      >
        {{ collapsed ? t('email.attention.show') : t('email.attention.hide') }}
        <ChevronDown :size="14" class="transition-transform" :class="collapsed ? '' : 'rotate-180'" aria-hidden="true" />
      </Button>
    </div>

    <ul v-if="!collapsed" class="divide-y divide-[var(--pill-warning)]/15">
      <li v-for="item in items" :key="item.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4 @2xl:flex-nowrap">
        <span
          class="inline-flex size-7 shrink-0 items-center justify-center rounded-full"
          :class="item.tone === 'err' ? 'bg-destructive/13 text-destructive' : 'bg-[var(--pill-warning)]/14 text-[var(--pill-warning)]'"
          aria-hidden="true"
        >
          <component :is="item.icon" :size="15" />
        </span>
        <div class="min-w-0 flex-[1_1_calc(100%-2.5rem)] @2xl:flex-1">
          <i18n-t :keypath="sentenceOf(item)" tag="p" class="text-sm text-foreground" scope="global">
            <template v-for="(slot, name) in item.slots" #[name] :key="name">
              <b v-if="slot.strong" class="font-semibold">{{ slot.text }}</b>
              <template v-else>{{ slot.text }}</template>
            </template>
          </i18n-t>
          <p class="mt-px text-xs text-muted-foreground [overflow-wrap:anywhere]">
            <template v-if="item.detailCode"
              ><span class="font-mono">{{ item.detailCode }}</span> · </template
            >{{ item.detail }}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          class="ms-10 h-7 shrink-0 rounded-[7px] px-[9px] text-[13px] @2xl:ms-0"
          :disabled="busyId === item.id"
          @click="handleAct(item)"
        >
          {{ item.actionLabel }}
        </Button>
      </li>
    </ul>
  </section>
</template>
