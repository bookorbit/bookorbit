<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Calendar, Check, ChevronDown } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate } from '@/i18n/formatters'
import type { AuditRangePreset } from '../useAuditLog'

const props = defineProps<{ preset: AuditRangePreset; from: string; to: string; oldestAt: string | null }>()
const emit = defineEmits<{ change: [range: { preset: AuditRangePreset; from: string; to: string }] }>()
const { t } = useI18n()
const open = ref(false)

const PRESETS: AuditRangePreset[] = ['today', '7d', '30d', 'all']

const presetLabel = (preset: AuditRangePreset) => t(`audit.range.${preset}`)

function shortDate(value: string) {
  return formatDate(new Date(`${value}T00:00:00`), { month: 'short', day: 'numeric' })
}

const buttonLabel = computed(() => {
  if (props.preset !== 'custom') return presetLabel(props.preset)
  if (props.from && props.to) return t('audit.range.between', { from: shortDate(props.from), to: shortDate(props.to) })
  if (props.from) return t('audit.range.since', { date: shortDate(props.from) })
  if (props.to) return t('audit.range.until', { date: shortDate(props.to) })
  return t('audit.range.custom')
})

const oldestLabel = computed(() =>
  props.oldestAt ? formatDate(new Date(props.oldestAt), { month: 'short', day: 'numeric', year: 'numeric' }) : null,
)

function choose(preset: AuditRangePreset) {
  emit('change', { preset, from: '', to: '' })
  open.value = false
}

function onFrom(event: Event) {
  emit('change', { preset: 'custom', from: (event.target as HTMLInputElement).value, to: props.preset === 'custom' ? props.to : '' })
}

function onTo(event: Event) {
  emit('change', { preset: 'custom', from: props.preset === 'custom' ? props.from : '', to: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        type="button"
        class="h-9 gap-1.5 px-2.5 max-md:size-9 max-md:px-0"
        :aria-label="t('audit.range.label', { range: buttonLabel })"
      >
        <Calendar :size="15" aria-hidden="true" />
        <span class="max-md:hidden">{{ buttonLabel }}</span>
        <ChevronDown :size="14" class="-ms-0.5 text-muted-foreground max-md:hidden" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-72 p-1.5">
      <ul>
        <li v-for="option in PRESETS" :key="option">
          <button
            type="button"
            class="flex h-[34px] w-full items-center gap-2 rounded-sm px-2 text-start text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            :class="preset === option ? 'font-medium' : ''"
            :aria-pressed="preset === option"
            @click="choose(option)"
          >
            <span>{{ presetLabel(option) }}</span>
            <span v-if="option === 'all' && oldestLabel" class="ms-auto text-xs font-normal text-muted-foreground">{{
              t('audit.range.sinceOldest', { date: oldestLabel })
            }}</span>
            <Check
              v-if="preset === option"
              :size="15"
              class="text-primary"
              :class="option === 'all' && oldestLabel ? '' : 'ms-auto'"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
      <div class="-mx-1.5 my-1.5 h-px bg-border" />
      <div class="px-2 pt-1 pb-2">
        <p class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{{ t('audit.range.custom') }}</p>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-xs text-muted-foreground">
            {{ t('audit.range.from') }}
            <input
              id="audit-range-from"
              type="date"
              class="input-field h-8 px-2 text-[13px]"
              :value="preset === 'custom' ? from : ''"
              @change="onFrom"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-muted-foreground">
            {{ t('audit.range.to') }}
            <input id="audit-range-to" type="date" class="input-field h-8 px-2 text-[13px]" :value="preset === 'custom' ? to : ''" @change="onTo" />
          </label>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
