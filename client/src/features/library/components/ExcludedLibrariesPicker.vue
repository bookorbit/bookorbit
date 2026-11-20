<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatList, formatNumber } from '@/i18n/formatters'
import { useLibraries } from '../composables/useLibraries'

const props = defineProps<{
  modelValue: number[]
  label: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()

const { t, locale } = useI18n()
const { libraries, loaded, fetchLibraries } = useLibraries()

const sortedLibraries = computed(() => [...libraries.value].sort((a, b) => a.name.localeCompare(b.name, locale.value, { sensitivity: 'base' })))
const selectedNames = computed(() => formatList(sortedLibraries.value.filter((library) => isExcluded(library.id)).map((library) => library.name)))

onMounted(() => {
  void fetchLibraries()
})

function isExcluded(libraryId: number): boolean {
  return props.modelValue.includes(libraryId)
}

function toggle(libraryId: number) {
  emit('update:modelValue', isExcluded(libraryId) ? props.modelValue.filter((id) => id !== libraryId) : [...props.modelValue, libraryId])
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        class="inline-flex h-10 w-full shrink-0 items-center justify-between gap-2 rounded-[7px] border border-input bg-background pr-2.5 pl-3 text-[13px] text-foreground transition-colors hover:border-[color-mix(in_oklch,var(--foreground)_30%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-[34px] sm:w-auto sm:max-w-[260px] sm:min-w-[200px]"
        :disabled="disabled"
        :aria-label="label"
        data-testid="excluded-libraries-trigger"
      >
        <span class="min-w-0 truncate" :class="selectedNames ? '' : 'text-muted-foreground'">{{
          selectedNames || t('settings.integrations.excludedLibraries.none')
        }}</span>
        <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" :side-offset="6" class="w-(--reka-popover-trigger-width) min-w-60 rounded-[10px] p-1 text-[13px]">
      <div role="group" :aria-label="label">
        <div class="px-[9px] pt-[7px] pb-[5px] text-[10.5px] font-bold tracking-[.08em] text-muted-foreground uppercase">
          {{ t('settings.integrations.excludedLibraries.menuLabel') }}
        </div>
        <p v-if="loaded && sortedLibraries.length === 0" class="px-[9px] py-2 text-muted-foreground">
          {{ t('settings.integrations.excludedLibraries.noLibraries') }}
        </p>
        <label
          v-for="library in sortedLibraries"
          :key="library.id"
          class="flex min-h-[34px] cursor-pointer items-center gap-2.5 rounded-[6px] px-[9px] hover:bg-accent hover:text-accent-foreground"
        >
          <input type="checkbox" class="m-0 size-[15px] accent-primary" :checked="isExcluded(library.id)" @change="toggle(library.id)" />
          <span class="min-w-0 truncate">{{ library.name }}</span>
          <span class="ms-auto text-xs/normal text-muted-foreground tabular-nums">{{ formatNumber(library.bookCount ?? 0) }}</span>
        </label>
        <div class="-mx-1 my-1 h-px bg-border" />
        <p class="px-[9px] pt-1.5 pb-[5px] text-[11.5px] leading-[1.4] text-muted-foreground">
          {{ t('settings.integrations.excludedLibraries.appliesOnSave') }}
        </p>
      </div>
    </PopoverContent>
  </Popover>
</template>
