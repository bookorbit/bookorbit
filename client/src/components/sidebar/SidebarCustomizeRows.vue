<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import SidebarCustomizeRow from '@/components/sidebar/SidebarCustomizeRow.vue'
import { formatNumber } from '@/i18n/formatters'
import { useListReorder } from '@/composables/useListReorder'
import { SIDEBAR_LOCKED_IDS, useSidebarLayout } from '@/composables/useSidebarLayout'
import type { ResolvedSidebarNavEntry } from '@/composables/useSidebarNav'

const props = defineProps<{
  zoneId: string
  /** Every row the user may see in this zone, arranged, hidden ones included. */
  entries: ResolvedSidebarNavEntry[]
}>()

const { t } = useI18n()
const { isHidden, toggleHidden, moveRows } = useSidebarLayout()

const lockedEntries = computed(() => props.entries.filter((entry) => SIDEBAR_LOCKED_IDS.has(entry.id)))
const movableEntries = computed(() => props.entries.filter((entry) => !SIDEBAR_LOCKED_IDS.has(entry.id)))
const entriesById = computed(() => new Map(props.entries.map((entry) => [entry.id, entry])))

const { items, liftedId, status, onDragStart, onDragEnd, handleGripKeydown, handleGripBlur } = useListReorder(
  () => movableEntries.value.map((entry) => entry.id),
  (order) => moveRows(props.zoneId, [...lockedEntries.value.map((entry) => entry.id), ...order]),
)

const announcement = computed(() => {
  const current = status.value
  if (!current) return ''
  return t(`components.sidebar.reorder.${current.kind}`, {
    name: entriesById.value.get(current.id)?.label ?? '',
    position: formatNumber(current.position),
    total: formatNumber(current.total),
  })
})

function entryOf(id: string): ResolvedSidebarNavEntry {
  return entriesById.value.get(id) as ResolvedSidebarNavEntry
}

function hiddenHintOf(id: string): string | undefined {
  return entryOf(id).returnsWithWork ? t('components.sidebar.customize.returnsWithWork') : undefined
}

function handleToggle(id: string) {
  toggleHidden(id)
}

function onGripKeydown(event: KeyboardEvent, id: string) {
  handleGripKeydown(event, id)
}

function onGripBlur(id: string) {
  handleGripBlur(id)
}
</script>

<template>
  <ul class="flex w-full min-w-0 flex-col gap-0.5">
    <slot name="leading" />
    <SidebarCustomizeRow v-for="entry in lockedEntries" :key="entry.id" :icon="entry.icon" :label="entry.label" locked />
    <VueDraggable
      v-model="items"
      tag="div"
      class="contents"
      handle=".row-drag-handle"
      :animation="150"
      :delay="200"
      :delay-on-touch-only="true"
      @start="onDragStart"
      @end="onDragEnd"
    >
      <SidebarCustomizeRow
        v-for="id in items"
        :key="id"
        :icon="entryOf(id).icon"
        :label="entryOf(id).label"
        :hidden="isHidden(id)"
        :lifted="liftedId === id"
        :hidden-hint="hiddenHintOf(id)"
        @toggle="handleToggle(id)"
        @grip-keydown="onGripKeydown($event, id)"
        @grip-blur="onGripBlur(id)"
      />
    </VueDraggable>
  </ul>
  <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
</template>
