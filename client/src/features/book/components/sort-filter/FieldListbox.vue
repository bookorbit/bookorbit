<script setup lang="ts" generic="T extends string">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Search } from '@lucide/vue'
import { ListboxContent, ListboxFilter, ListboxGroup, ListboxGroupLabel, ListboxItem, ListboxRoot, type ListboxItemSelectEvent } from 'reka-ui'
import { cn } from '@/lib/utils'
import { filterFieldGroups, splitMatch, type FieldOptionGroup } from './field-listbox'

/**
 * A searchable, sectioned list of fields: the sort panel, the filter picker and the builder's field
 * menus share it. Typing narrows the list and drops the headings; arrows and Enter pick from the
 * search box, which keeps focus throughout.
 */
const props = withDefaults(
  defineProps<{
    groups: FieldOptionGroup<T>[]
    selected?: T | null
    /** Fields left out, such as the ones a sort already uses. */
    exclude?: readonly T[]
    placeholder: string
    searchLabel: string
    listLabel: string
    /** Shows the search box; by default only once there are more than eight fields. */
    searchable?: boolean
    autofocus?: boolean
    listClass?: string
  }>(),
  { selected: null, exclude: () => [], searchable: undefined, autofocus: true, listClass: '' },
)

const emit = defineEmits<{
  pick: [value: T]
}>()

defineSlots<{
  /** Rows shown above the fields while nothing is typed, such as a panel's active filters. */
  before?: () => unknown
}>()

const { t } = useI18n()

const query = ref('')
const total = computed(() => props.groups.reduce((sum, group) => sum + group.options.filter((o) => !props.exclude.includes(o.value)).length, 0))
const showSearch = computed(() => props.searchable ?? total.value > 8)
const visibleGroups = computed(() => filterFieldGroups(props.groups, query.value, props.exclude))
const searching = computed(() => query.value.trim().length > 0)

function handleSelect(event: ListboxItemSelectEvent<T>) {
  // The parent owns what is picked; the listbox only reports it.
  event.preventDefault()
  emit('pick', event.detail.value as T)
}

function parts(label: string) {
  return splitMatch(label, query.value)
}

defineExpose({ clearQuery: () => (query.value = '') })
</script>

<template>
  <ListboxRoot :model-value="selected ?? undefined" highlight-on-hover class="flex min-h-0 flex-col">
    <div v-if="showSearch" class="shrink-0 px-2.5 pt-2.5 pb-2">
      <label
        class="flex h-8 items-center gap-[7px] rounded-[calc(var(--radius)-3px)] border border-border bg-background px-[9px] focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-primary/15 max-sm:h-10"
      >
        <Search :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        <ListboxFilter
          v-model="query"
          :auto-focus="autofocus"
          type="search"
          :placeholder="placeholder"
          :aria-label="searchLabel"
          class="field-listbox-search min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground max-sm:text-[15px]"
        />
      </label>
    </div>
    <div :class="cn('min-h-0 overflow-y-auto overscroll-contain px-1 pb-1', listClass)">
      <slot v-if="!searching" name="before" />
      <ListboxContent :aria-label="listLabel" class="outline-none">
        <ListboxGroup v-for="group in visibleGroups" :key="group.key">
          <ListboxGroupLabel
            v-if="group.label && !searching"
            class="px-2 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
          >
            {{ group.label }}
          </ListboxGroupLabel>
          <ListboxItem
            v-for="option in group.options"
            :key="option.value"
            :value="option.value"
            class="group/row flex min-h-8 w-full cursor-pointer items-center gap-[9px] rounded-[calc(var(--radius)-4px)] px-2 text-start text-[13px] text-foreground outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:font-semibold data-[state=checked]:text-primary max-sm:min-h-[42px] max-sm:px-2.5 max-sm:text-[14.5px]"
            @select="handleSelect"
          >
            <component
              :is="option.icon"
              :size="15"
              class="shrink-0 text-muted-foreground group-data-[state=checked]/row:text-primary"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate">
              <template v-if="searching">
                {{ parts(option.label)[0]
                }}<mark v-if="parts(option.label)[1]" class="rounded-[2px] bg-primary/25 text-inherit">{{ parts(option.label)[1] }}</mark
                >{{ parts(option.label)[2] }}
              </template>
              <template v-else>{{ option.label }}</template>
            </span>
            <Check v-if="option.value === selected" :size="15" class="ms-auto shrink-0 text-primary" aria-hidden="true" />
          </ListboxItem>
        </ListboxGroup>
        <p v-if="visibleGroups.length === 0" class="px-2.5 py-[18px] text-center text-[12.5px] text-muted-foreground">
          {{ t('book.sort.noFieldMatch', { query: query.trim() }) }}
        </p>
      </ListboxContent>
    </div>
  </ListboxRoot>
</template>

<style scoped>
.field-listbox-search::-webkit-search-decoration,
.field-listbox-search::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}
</style>
