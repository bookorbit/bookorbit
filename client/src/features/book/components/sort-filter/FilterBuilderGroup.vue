<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Ellipsis, Layers, Plus, Trash2 } from '@lucide/vue'
import type { AcceptableValue } from 'reka-ui'
import type { GroupRule, RuleField } from '@bookorbit/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import FieldPickerPopover from './FieldPickerPopover.vue'
import FilterBuilderRow from './FilterBuilderRow.vue'
import { FILTER_BUILDER_KEY, type DraftGroup } from './filter-builder'
import { ghostButton, iconButton } from './filter-styles'

/** A nested group, drawn as an indented rail: "Any of these", its rules, and its own Add filter. */
const props = defineProps<{
  group: DraftGroup
  parent: DraftGroup
  index: number
  /** How deep this group sits; the root is 0. */
  depth: number
}>()

const { t } = useI18n()
const context = inject(FILTER_BUILDER_KEY)!
const { fields } = context

const joinLabel = computed(() => (props.group.join === 'OR' ? t('book.filter.builder.groupAny') : t('book.filter.builder.groupAll')))
const addOpen = computed(() => context.openFieldFor.value === `add:${props.group.id}`)

function handleJoin(value: AcceptableValue) {
  if (value === 'AND' || value === 'OR') context.setJoin(props.group, value as GroupRule['join'])
}

function handleAddOpen(open: boolean) {
  context.openFieldFor.value = open ? `add:${props.group.id}` : null
}

function handleAdd(field: RuleField) {
  context.addRule(props.group, field)
}

function handleUngroup() {
  context.ungroup(props.parent, props.index)
}

function handleRemove() {
  context.remove(props.parent, props.index)
}
</script>

<template>
  <div
    class="my-1 ms-1.5 border-s-2 border-primary/50 ps-3 pt-0.5 pb-1"
    role="group"
    :aria-label="`${joinLabel} ${t('book.filter.builder.ofThese')}`"
    data-testid="filter-builder-group"
  >
    <div class="group/grouphead flex min-h-8 items-center gap-1 text-[12.5px] text-muted-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button type="button" :class="ghostButton" class="-ms-2" :aria-label="`${t('book.filter.builder.changeJoin')}: ${joinLabel}`">
            <span class="font-semibold text-foreground">{{ joinLabel }}</span>
            <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-40">
          <DropdownMenuRadioGroup :model-value="group.join" @update:model-value="handleJoin">
            <DropdownMenuRadioItem value="AND">{{ t('book.filter.builder.groupAll') }}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="OR">{{ t('book.filter.builder.groupAny') }}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span>{{ t('book.filter.builder.ofThese') }}</span>
      <span class="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            :class="iconButton"
            class="opacity-0 transition-opacity group-hover/grouphead:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 max-sm:opacity-100"
            :aria-label="t('book.filter.builder.moreForGroup')"
          >
            <Ellipsis :size="14" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem @select="handleUngroup">
            <Layers :size="14" aria-hidden="true" />
            {{ t('book.filter.builder.ungroup') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="handleRemove">
            <Trash2 :size="14" aria-hidden="true" />
            {{ t('book.filter.builder.removeGroup') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <template v-for="(child, childIndex) in group.children" :key="child.id">
      <FilterBuilderGroup v-if="child.kind === 'group'" :group="child" :parent="group" :index="childIndex" :depth="depth + 1" />
      <FilterBuilderRow v-else :node="child" :parent="group" :index="childIndex" :depth="depth" />
    </template>

    <div class="flex items-center gap-1 pt-1 pb-0.5">
      <FieldPickerPopover
        :open="addOpen"
        :groups="fields.groups.value"
        :title="t('book.filter.builder.addFilter')"
        :placeholder="t('book.filter.filterBy')"
        :search-label="t('book.filter.findFieldAria')"
        :list-label="t('book.filter.fieldList')"
        @update:open="handleAddOpen"
        @pick="handleAdd"
      >
        <template #trigger>
          <button type="button" :class="ghostButton" class="-ms-2 text-muted-foreground hover:text-foreground" aria-haspopup="dialog">
            <Plus :size="13" aria-hidden="true" />
            {{ t('book.filter.builder.addFilter') }}
          </button>
        </template>
      </FieldPickerPopover>
    </div>
  </div>
</template>
