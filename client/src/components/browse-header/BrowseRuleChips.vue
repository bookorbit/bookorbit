<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GroupRule } from '@bookorbit/types'
import { ruleToParts } from '@/features/book/lib/filter-labels'

/**
 * A smart scope's own rules, read-only, in the bar's chip size. Owners open the editor from any
 * chip; everyone else just reads them.
 */
const props = defineProps<{
  rules: GroupRule
  editable?: boolean
}>()

const emit = defineEmits<{
  edit: []
}>()

const { t } = useI18n()

const chips = computed(() =>
  props.rules.rules.map((rule, index) => {
    if (rule.type === 'group') {
      return {
        key: index,
        field:
          rule.join === 'OR'
            ? t('components.browseHeader.tokens.anyOf', { count: rule.rules.length })
            : t('components.browseHeader.tokens.allOf', { count: rule.rules.length }),
        operator: '',
        value: null as string | null,
      }
    }
    return { key: index, ...ruleToParts(rule) }
  }),
)

const joinLabel = computed(() => (props.rules.join === 'AND' ? t('book.filter.all') : t('book.filter.any')))

function handleChipClick() {
  if (props.editable) emit('edit')
}
</script>

<template>
  <span
    class="shrink-0 rounded-xs px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase"
    :class="rules.join === 'OR' ? 'bg-amber-500/15 text-amber-500' : 'bg-sky-500/15 text-sky-500'"
    >{{ joinLabel }}</span
  >
  <component
    :is="editable ? 'button' : 'span'"
    v-for="chip in chips"
    :key="chip.key"
    :type="editable ? 'button' : undefined"
    class="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 text-[12.5px] whitespace-nowrap"
    :class="editable ? 'transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none' : ''"
    @click="handleChipClick"
  >
    <span class="font-semibold text-foreground">{{ chip.field }}</span>
    <span v-if="chip.operator" :class="chip.value === null ? 'font-semibold text-primary' : 'text-muted-foreground'">{{ chip.operator }}</span>
    <span v-if="chip.value !== null" class="max-w-[12rem] truncate font-semibold text-primary">{{ chip.value }}</span>
  </component>
</template>
