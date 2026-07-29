<script setup lang="ts">
import { computed, ref, toRef, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, GripVertical, Search, X } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import { SIDEBAR_DEFAULT_CAP, type SidebarCap, type SidebarSectionId } from '@bookorbit/types'
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar'
import SidebarNavItem from '@/components/sidebar/SidebarNavItem.vue'
import SidebarSectionHeader from '@/components/sidebar/SidebarSectionHeader.vue'
import SidebarBadge from '@/components/sidebar/SidebarBadge.vue'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { useDraggableOrder } from '@/composables/useDraggableOrder'
import { useSidebarPrefs } from '@/composables/useSidebarPrefs'

export interface SidebarEntity {
  id: number
  displayOrder: number
  name: string
  icon?: string | null
  bookCount?: number | null
}

const props = withDefaults(
  defineProps<{
    sectionId: SidebarSectionId
    label: string
    items: SidebarEntity[]
    routeName: string
    indexRouteName: string
    activeId: number | null
    fallbackIcon: string
    emptyText: string
    filterLabel: string
    filterPlaceholder: string
    seeAllLabel: string
    canAdd?: boolean
    addLabel?: string
    canReorder?: boolean
    persistOrder?: (order: { id: number; displayOrder: number }[]) => Promise<void>
    tourId?: string
    /** Rail popovers render the body regardless of the stored open state. */
    alwaysOpen?: boolean
  }>(),
  { canAdd: false, canReorder: false, addLabel: undefined, persistOrder: undefined, tourId: undefined, alwaysOpen: false },
)

const emit = defineEmits<{ add: []; navigate: [] }>()

const { t } = useI18n()
const { sections, toggleSection, setSectionCap } = useSidebarPrefs()

const contentId = `sidebar-section-${useId()}`
const filterInputId = `${contentId}-filter`
const query = ref('')

const noopPersist = async () => {}
const {
  localItems,
  liftedId,
  status: reorderStatus,
  onDragStart,
  onDragEnd,
  handleGripKeydown,
  handleGripBlur,
} = useDraggableOrder({
  source: toRef(props, 'items'),
  persist: (order) => (props.persistOrder ? props.persistOrder(order) : noopPersist()),
})

const sectionState = computed(() => sections[props.sectionId])
const isOpen = computed(() => props.alwaysOpen || sectionState.value.open)
const cap = computed<SidebarCap>(() => sectionState.value.cap)
const capValue = computed(() => (cap.value === 'all' ? Number.POSITIVE_INFINITY : cap.value))

const total = computed(() => localItems.value.length)
const isFiltering = computed(() => query.value.trim().length > 0)

/** "All" still hides nothing, but a long list is worth filtering, so fall back to the
 *  default cap as the threshold in that case. */
const showFilter = computed(() => total.value > (cap.value === 'all' ? SIDEBAR_DEFAULT_CAP : cap.value))

const matchedItems = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return localItems.value
  return localItems.value.filter((item) => item.name.toLocaleLowerCase().includes(needle))
})

const visibleItems = computed(() => (Number.isFinite(capValue.value) ? matchedItems.value.slice(0, capValue.value) : matchedItems.value))

const showSeeAll = computed(() => total.value > capValue.value)

/** Reordering is an explicit mode entered from the section menu. Grips are a rare action,
 *  so they stay out of the way until the user asks for them. */
const isReordering = ref(false)
const canEnterReorder = computed(() => Boolean(props.canReorder && props.persistOrder) && total.value > 1)
const dragEnabled = computed(() => isReordering.value && canEnterReorder.value && !isFiltering.value)

function toggleReorder() {
  isReordering.value = !isReordering.value
}

watch(isFiltering, (filtering) => {
  if (filtering) isReordering.value = false
})

const filterSummary = computed(() =>
  t('components.sidebar.filterSummary', { shown: formatNumber(visibleItems.value.length), total: formatNumber(total.value) }),
)

const reorderAnnouncement = computed(() => {
  const current = reorderStatus.value
  if (!current) return ''
  return t(`components.sidebar.reorder.${current.kind}`, {
    name: current.item.name,
    position: formatNumber(current.position),
    total: formatNumber(current.total),
  })
})

function handleToggle() {
  toggleSection(props.sectionId)
}

function handleCapChange(next: SidebarCap) {
  setSectionCap(props.sectionId, next)
}

function handleAdd() {
  emit('add')
}

function handleNavigate() {
  emit('navigate')
}

function clearQuery() {
  query.value = ''
}

function handleFilterKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    clearQuery()
  }
}

function itemRoute(id: number) {
  return { name: props.routeName, params: { id } }
}

function itemCount(item: SidebarEntity): number | null {
  return typeof item.bookCount === 'number' ? item.bookCount : null
}

function gripLabel(item: SidebarEntity): string {
  return t('components.sidebar.reorder.gripAria', { name: item.name })
}

function onGripKeydown(event: KeyboardEvent, id: number) {
  handleGripKeydown(event, id)
}

function onGripBlur(id: number) {
  handleGripBlur(id)
}
</script>

<template>
  <SidebarGroup :data-tour="tourId">
    <SidebarSectionHeader
      :label="label"
      :is-open="isOpen"
      :content-id="contentId"
      :count="total"
      :can-add="canAdd"
      :add-label="addLabel"
      :cap="cap"
      :can-change-cap="total > 0"
      :can-reorder="canEnterReorder && !isFiltering"
      :is-reordering="isReordering"
      :collapsible="!alwaysOpen"
      @toggle="handleToggle"
      @add="handleAdd"
      @update:cap="handleCapChange"
      @toggle-reorder="toggleReorder"
    />

    <Transition name="section">
      <div v-if="isOpen" :id="contentId">
        <SidebarGroupContent>
          <div v-if="showFilter" class="mb-1 flex h-8 items-center gap-1.5 rounded-md border border-(--shell-accent-line) px-2">
            <Search :size="13" aria-hidden="true" class="shrink-0 text-muted-foreground" />
            <label :for="filterInputId" class="sr-only">{{ filterLabel }}</label>
            <input
              :id="filterInputId"
              v-model="query"
              type="text"
              :placeholder="filterPlaceholder"
              class="h-full w-full min-w-0 bg-transparent text-[14px] text-sidebar-foreground outline-none placeholder:text-muted-foreground"
              @keydown="handleFilterKeydown"
            />
            <button
              v-if="isFiltering"
              type="button"
              class="shrink-0 rounded-sm text-muted-foreground transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              :aria-label="t('components.sidebar.clearFilter')"
              @click="clearQuery"
            >
              <X :size="13" aria-hidden="true" />
            </button>
          </div>

          <SidebarMenu>
            <VueDraggable
              v-model="localItems"
              tag="div"
              class="contents"
              :animation="150"
              handle=".drag-handle"
              :disabled="!dragEnabled"
              :delay="200"
              :delay-on-touch-only="true"
              @start="onDragStart"
              @end="onDragEnd"
            >
              <SidebarNavItem
                v-for="item in visibleItems"
                :key="item.id"
                :is-active="activeId === item.id"
                :tooltip="item.name"
                :to="itemRoute(item.id)"
                :icon="item.icon || fallbackIcon"
                :fallback-icon="fallbackIcon"
                :label="item.name"
                @navigate="handleNavigate"
              >
                <template #badge>
                  <slot name="itemBadge" :item="item">
                    <SidebarBadge v-if="itemCount(item) !== null">{{ formatCompactNumber(itemCount(item) ?? 0) }}</SidebarBadge>
                  </slot>
                </template>
                <template v-if="dragEnabled" #trailing>
                  <button
                    type="button"
                    class="drag-handle flex h-8 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                    :class="liftedId === item.id ? 'text-primary' : 'text-muted-foreground'"
                    :aria-label="gripLabel(item)"
                    :aria-pressed="liftedId === item.id"
                    @keydown="onGripKeydown($event, item.id)"
                    @blur="onGripBlur(item.id)"
                  >
                    <GripVertical :size="13" aria-hidden="true" />
                  </button>
                </template>
                <template #extra>
                  <slot name="itemExtra" :item="item" />
                </template>
              </SidebarNavItem>
            </VueDraggable>
          </SidebarMenu>

          <p v-if="isFiltering" class="px-2 pt-1 text-[13px] text-muted-foreground" aria-live="polite">{{ filterSummary }}</p>
          <p v-else-if="total === 0" class="px-2 py-1 text-[13px] text-muted-foreground">{{ emptyText }}</p>
          <p v-if="isFiltering && canReorder" class="px-2 text-[13px] text-muted-foreground">{{ t('components.sidebar.reorder.filteredHint') }}</p>

          <RouterLink
            v-if="showSeeAll && !isFiltering"
            :to="{ name: indexRouteName }"
            class="mt-0.5 flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            @click="handleNavigate"
          >
            <span class="min-w-0 truncate">{{ seeAllLabel }}</span>
            <ArrowRight :size="13" aria-hidden="true" class="shrink-0" />
          </RouterLink>

          <p class="sr-only" role="status" aria-live="polite">{{ reorderAnnouncement }}</p>
        </SidebarGroupContent>
      </div>
    </Transition>
  </SidebarGroup>
</template>

<style scoped>
.section-enter-active,
.section-leave-active {
  transition:
    opacity 0.2s ease,
    max-height 0.2s ease;
  overflow: hidden;
}
.section-enter-from,
.section-leave-to {
  opacity: 0;
  max-height: 0;
}
.section-enter-to,
.section-leave-from {
  opacity: 1;
  max-height: 60rem;
}

@media (prefers-reduced-motion: reduce) {
  .section-enter-active,
  .section-leave-active {
    transition: none;
  }
}
</style>
