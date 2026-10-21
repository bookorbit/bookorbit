<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, SlidersHorizontal } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import { SidebarGroup, SidebarSeparator } from '@/components/ui/sidebar'
import SidebarCustomizeControls from '@/components/sidebar/SidebarCustomizeControls.vue'
import SidebarCustomizeRow from '@/components/sidebar/SidebarCustomizeRow.vue'
import SidebarCustomizeRows from '@/components/sidebar/SidebarCustomizeRows.vue'
import type { SidebarBlockKind } from '@/components/sidebar/sidebar-layout'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { useListReorder } from '@/composables/useListReorder'
import { useSidebarCustomizeMode } from '@/composables/useSidebarCustomizeMode'
import { useSidebarLayout } from '@/composables/useSidebarLayout'
import type { ResolvedSidebarNavEntry } from '@/composables/useSidebarNav'

export interface SidebarCustomizeGroup {
  id: string
  kind: SidebarBlockKind
  label: string
  /** List sections fold to their header while editing and show how many rows they hold. */
  count: number | null
  entries: ResolvedSidebarNavEntry[]
}

const props = defineProps<{
  primaryEntries: ResolvedSidebarNavEntry[]
  groups: SidebarCustomizeGroup[]
}>()

const { t } = useI18n()
const { isHidden, toggleHidden, moveGroups } = useSidebarLayout()
const { stopCustomizing } = useSidebarCustomizeMode()

const titleId = `sidebar-customize-${useId()}`
const titleRef = ref<HTMLElement | null>(null)
const groupsById = computed(() => new Map(props.groups.map((group) => [group.id, group])))

const {
  items: groupIds,
  liftedId,
  status,
  onDragStart,
  onDragEnd,
  handleGripKeydown,
  handleGripBlur,
} = useListReorder(
  () => props.groups.map((group) => group.id),
  (order) => moveGroups(order),
)

const announcement = computed(() => {
  const current = status.value
  if (!current) return ''
  return t(`components.sidebar.reorder.${current.kind}`, {
    name: groupsById.value.get(current.id)?.label ?? '',
    position: formatNumber(current.position),
    total: formatNumber(current.total),
  })
})

function groupOf(id: string): SidebarCustomizeGroup {
  return groupsById.value.get(id) as SidebarCustomizeGroup
}

/** Same rule as the live sidebar: a line only where nav groups meet list sections. The pinned top group is nav. */
function separatorBefore(index: number): boolean {
  const previous = index === 0 ? 'nav' : groupOf(groupIds.value[index - 1] as string)?.kind
  return groupOf(groupIds.value[index] as string)?.kind !== previous
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

/** A grip that is carrying a row claims Escape first, so this only fires when nothing is lifted. */
function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  stopCustomizing()
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
  titleRef.value?.focus({ preventScroll: true })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <section class="flex flex-col" :aria-labelledby="titleId" data-testid="sidebar-customizer">
    <!-- The 20px icon slot and 8px gap put the title and hint on the same columns as the rows below. -->
    <div class="mx-2 mt-1.5 mb-0.5 rounded-(--shell-radius) border border-(--shell-accent-line) bg-(--shell-accent-tint) px-[7px] pt-2 pb-[9px]">
      <h2
        :id="titleId"
        ref="titleRef"
        tabindex="-1"
        class="flex items-center gap-2 text-[13px] leading-tight font-semibold text-sidebar-foreground outline-hidden"
      >
        <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center text-primary">
          <SlidersHorizontal :size="15" aria-hidden="true" />
        </span>
        {{ t('components.sidebar.customize.title') }}
      </h2>
      <p class="mt-0.5 ps-7 text-[12.5px] leading-snug text-balance text-muted-foreground">{{ t('components.sidebar.customize.hint') }}</p>
    </div>

    <SidebarGroup>
      <SidebarCustomizeRows zone-id="primary" :entries="primaryEntries">
        <template #leading>
          <SidebarCustomizeRow :icon="Search" :label="t('common.search')" locked />
        </template>
      </SidebarCustomizeRows>
    </SidebarGroup>

    <VueDraggable
      v-model="groupIds"
      tag="div"
      handle=".group-drag-handle"
      :animation="150"
      :delay="200"
      :delay-on-touch-only="true"
      @start="onDragStart"
      @end="onDragEnd"
    >
      <div v-for="(id, index) in groupIds" :key="id">
        <SidebarSeparator v-if="separatorBefore(index)" />
        <!-- Inset 6px with 2px padding, so a lifted group's wash stops short of the sidebar edge without moving its columns. -->
        <SidebarGroup
          class="mx-1.5 w-auto rounded-md px-0.5 transition-colors duration-150"
          :class="liftedId === id ? 'bg-(--shell-accent-wash)' : ''"
        >
          <div class="flex h-8 min-w-0 items-center gap-1.5 px-2">
            <span class="sidebar-section-label min-w-0 truncate" :class="isHidden(id) ? 'text-muted-foreground' : ''">{{ groupOf(id).label }}</span>
            <span
              v-if="groupOf(id).count !== null"
              class="sidebar-count shrink-0 rounded-md px-1.5 tabular-nums"
              :class="isHidden(id) ? 'text-muted-foreground' : ''"
              >{{ formatCompactNumber(groupOf(id).count ?? 0) }}</span
            >
            <SidebarCustomizeControls
              class="ms-auto"
              :name="groupOf(id).label"
              :hidden="isHidden(id)"
              :locked="false"
              :lifted="liftedId === id"
              handle-class="group-drag-handle"
              @toggle="handleToggle(id)"
              @grip-keydown="onGripKeydown($event, id)"
              @grip-blur="onGripBlur(id)"
            />
          </div>
          <SidebarCustomizeRows v-if="groupOf(id).kind === 'nav' && !isHidden(id)" :zone-id="id" :entries="groupOf(id).entries" />
        </SidebarGroup>
      </div>
    </VueDraggable>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
  </section>
</template>
