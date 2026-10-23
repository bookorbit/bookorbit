<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Orbit } from '@lucide/vue'
import type { Library, LibraryType } from '@bookorbit/types'
import { formatCompactNumber } from '@/i18n/formatters'
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import SidebarZone from '@/components/sidebar/SidebarZone.vue'
import SidebarNavItem from '@/components/sidebar/SidebarNavItem.vue'
import SidebarBadge from '@/components/sidebar/SidebarBadge.vue'
import SidebarEntitySection from '@/components/sidebar/SidebarEntitySection.vue'
import SidebarModeSwitch from '@/components/sidebar/SidebarModeSwitch.vue'
import SidebarSectionPopover from '@/components/sidebar/SidebarSectionPopover.vue'
import SidebarFooterBar from '@/components/sidebar/SidebarFooterBar.vue'
import SidebarDock from '@/components/sidebar/SidebarDock.vue'
import SidebarSearchItem from '@/components/sidebar/SidebarSearchItem.vue'
import SidebarCustomizer, { type SidebarCustomizeGroup } from '@/components/sidebar/SidebarCustomizer.vue'
import SidebarCustomizeBar from '@/components/sidebar/SidebarCustomizeBar.vue'
import { groupRuns } from '@/components/sidebar/sidebar-layout'
import { useSidebarDataSync } from '@/composables/useSidebarDataSync'
import { useSidebarNav, type SidebarNavZone } from '@/composables/useSidebarNav'
import { useSidebarLayout } from '@/composables/useSidebarLayout'
import { useSidebarCustomizeMode } from '@/composables/useSidebarCustomizeMode'
import { useSidebarSections, type SidebarListKind, type SidebarSection } from '@/composables/useSidebarSections'
import { useSidebarLibraryActivity } from '@/composables/useSidebarLibraryActivity'
import { mediaModeHome, useMediaMode } from '@/composables/useMediaMode'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import CreateSmartScopeDialog from '@/features/smart-scope/components/CreateSmartScopeDialog.vue'
import CreateCollectionDialog from '@/features/collection/components/CreateCollectionDialog.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import SettingsSidebar from '@/features/settings/components/SettingsSidebar.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { state, isMobile, openMobile, setOpen, setOpenMobile } = useSidebar()
const { mode, setMode, syncModeFromRoute } = useMediaMode()
const { outstandingRequestTotal } = useSidebarDataSync()
const { zones } = useSidebarNav(() => outstandingRequestTotal.value)
const { sections, podcastLibraries, podcastsAvailable } = useSidebarSections()
const { subscribe: subscribeLibraryActivity } = useSidebarLibraryActivity()
const { handleLibraryCreated } = useLibraryCreationRedirect()
const { isHidden, arrangeRows, visibleRows, arrangeGroups } = useSidebarLayout()
const { isCustomizing, stopCustomizing } = useSidebarCustomizeMode()

const isRail = computed(() => state.value === 'collapsed' && !isMobile.value)
const isSettingsRoute = computed(() => typeof route.name === 'string' && route.name.startsWith('settings-'))

type SidebarBlock = { kind: 'nav'; id: string; zone: SidebarNavZone } | { kind: 'list'; id: string; section: SidebarSection }

/** Fixed destinations stay pinned on top: they are a known height, so nothing the user moves can push them off the first screenful. */
const primaryZone = computed(() => zones.value.find((zone) => zone.id === 'primary') ?? null)
const primaryEntries = computed(() => (primaryZone.value ? visibleRows('primary', primaryZone.value.entries) : []))

/** Every movable group in the user's order, hidden ones included. */
const arrangedBlocks = computed<SidebarBlock[]>(() =>
  arrangeGroups<SidebarBlock>([
    ...zones.value.filter((zone) => zone.id !== 'primary').map((zone) => ({ kind: 'nav' as const, id: zone.id, zone })),
    ...sections.value.map((section) => ({ kind: 'list' as const, id: section.id, section })),
  ]),
)

const runs = computed(() =>
  groupRuns(
    arrangedBlocks.value
      .filter((block) => !isHidden(block.id))
      .map((block): SidebarBlock =>
        block.kind === 'nav' ? { ...block, zone: { ...block.zone, entries: visibleRows(block.id, block.zone.entries) } } : block,
      )
      .filter((block) => block.kind === 'list' || block.zone.entries.length > 0),
  ).map((run) => ({ ...run, key: run.blocks.map((block) => block.id).join(',') })),
)

const customizePrimaryEntries = computed(() => (primaryZone.value ? arrangeRows('primary', primaryZone.value.entries) : []))
const customizeGroups = computed<SidebarCustomizeGroup[]>(() =>
  arrangedBlocks.value.map((block) =>
    block.kind === 'nav'
      ? {
          id: block.id,
          kind: 'nav',
          label: block.zone.labelKey ? t(block.zone.labelKey) : '',
          count: null,
          entries: arrangeRows(block.id, block.zone.entries),
        }
      : { id: block.id, kind: 'list', label: block.section.props.label, count: block.section.props.items.length, entries: [] },
  ),
)

/** Editing needs the full-width list, so the rail opens for it and folds back afterwards. */
let collapseAfterCustomizing = false
watch(isCustomizing, (customizing) => {
  if (customizing) {
    if (isMobile.value) setOpenMobile(true)
    else if (state.value === 'collapsed') {
      collapseAfterCustomizing = true
      setOpen(true)
    }
    return
  }
  if (collapseAfterCustomizing) {
    collapseAfterCustomizing = false
    if (!isMobile.value) setOpen(false)
  }
})

watch(isSettingsRoute, (settings) => {
  if (settings) stopCustomizing()
})

watch(openMobile, (open) => {
  if (!open && isMobile.value) stopCustomizing()
})

watch(
  () => route.name,
  (routeName) => syncModeFromRoute(routeName),
  { immediate: true },
)

watch(podcastsAvailable, (available) => {
  if (!available && mode.value === 'podcasts') setMode('books')
})

async function handleModeSwitch(target: LibraryType) {
  setMode(target)
  await router.push(mediaModeHome(target, podcastLibraries.value))
  handleNavigate()
}

function handleNavigate() {
  if (isMobile.value) setOpenMobile(false)
}

const openCreateDialog = ref<SidebarListKind | null>(null)
/** Kept per dialog and never reset, so a closing dialog does not swap to the other medium's copy mid-animation. */
const createMediaType = reactive<Record<SidebarListKind, LibraryType>>({ library: 'books', smartScope: 'books', collection: 'books' })
/** A podcast scope belongs to one library; the first is the sensible default target. */
const defaultPodcastLibraryId = computed(() => podcastLibraries.value[0]?.id ?? null)

function handleAdd(section: SidebarSection) {
  createMediaType[section.kind] = section.medium
  openCreateDialog.value = section.kind
}

function closeCreateDialog() {
  openCreateDialog.value = null
}

async function onLibrarySaved(library: Library) {
  closeCreateDialog()
  subscribeLibraryActivity(library)
  await handleLibraryCreated(library)
}
</script>

<template>
  <CreateSmartScopeDialog
    :open="openCreateDialog === 'smartScope'"
    :media-type="createMediaType.smartScope"
    :library-id="defaultPodcastLibraryId"
    @close="closeCreateDialog"
  />
  <CreateCollectionDialog :open="openCreateDialog === 'collection'" :media-type="createMediaType.collection" @close="closeCreateDialog" />
  <LibraryCreatorModal
    v-if="openCreateDialog === 'library'"
    :initial-type="createMediaType.library"
    @close="closeCreateDialog"
    @saved="onLibrarySaved"
  />

  <Sidebar variant="floating" collapsible="icon">
    <!-- px-4 puts the logo on the same left edge as the nav row icons (group px-2 + row px-2). -->
    <SidebarHeader class="border-b border-sidebar-border px-4 py-2.5 group-data-[collapsible=icon]:px-2">
      <div class="flex min-w-0 items-center gap-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5">
        <RouterLink
          to="/"
          class="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-(--shell-radius) outline-hidden group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          :aria-label="t('components.sidebar.dashboard')"
          @click="handleNavigate"
        >
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--shell-radius) bg-primary ring-1 ring-(--shell-accent-line)"
            aria-hidden="true"
          >
            <Orbit :size="21" class="text-primary-foreground" />
          </div>
          <span class="truncate font-serif text-[18px] font-semibold leading-none text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            Book<span class="text-primary"> Orbit</span>
          </span>
        </RouterLink>
        <SidebarTrigger
          v-if="!isMobile"
          class="-me-1.5 size-7 shrink-0 rounded-md text-sidebar-foreground hover:bg-(--shell-accent-wash) group-data-[collapsible=icon]:me-0"
        />
      </div>
      <SidebarModeSwitch v-if="podcastsAvailable" :mode="mode" :rail="isRail" class="mt-1.5" @switch="handleModeSwitch" />
    </SidebarHeader>

    <SidebarContent>
      <!-- Settings takes over the sidebar rather than adding a second one next to it. -->
      <SettingsSidebar v-if="isSettingsRoute" :is-rail="isRail" />

      <SidebarCustomizer v-else-if="isCustomizing" :primary-entries="customizePrimaryEntries" :groups="customizeGroups" />

      <template v-else>
        <SidebarZone v-if="primaryZone" :label="null" :always-open="isRail">
          <SidebarSearchItem />
          <SidebarNavItem
            v-for="entry in primaryEntries"
            :key="entry.id"
            :is-active="entry.isActive"
            :tooltip="entry.badge?.label ?? entry.label"
            :to="entry.to"
            :icon="entry.icon"
            :label="entry.label"
            :data-tour="entry.tourId"
            @navigate="handleNavigate"
          >
            <template #badge>
              <SidebarBadge v-if="entry.badge !== null" :tone="entry.badge.tone" :label="entry.badge.label">{{
                formatCompactNumber(entry.badge.value)
              }}</SidebarBadge>
            </template>
          </SidebarNavItem>
        </SidebarZone>

        <!-- Groups follow in the user's order. A separator sits wherever nav groups meet list
             sections; the pinned top group counts as nav. -->
        <template v-for="(run, runIndex) in runs" :key="run.key">
          <SidebarSeparator v-if="runIndex > 0 || run.kind === 'list'" />

          <template v-if="run.kind === 'nav'">
            <template v-for="block in run.blocks" :key="block.id">
              <SidebarZone
                v-if="block.kind === 'nav'"
                :label="block.zone.labelKey ? t(block.zone.labelKey) : null"
                :section-id="block.zone.sectionId ?? undefined"
                :always-open="isRail"
              >
                <SidebarNavItem
                  v-for="entry in block.zone.entries"
                  :key="entry.id"
                  :is-active="entry.isActive"
                  :tooltip="entry.badge?.label ?? entry.label"
                  :to="entry.to"
                  :icon="entry.icon"
                  :label="entry.label"
                  :data-tour="entry.tourId"
                  @navigate="handleNavigate"
                >
                  <template #badge>
                    <SidebarBadge v-if="entry.badge !== null" :tone="entry.badge.tone" :label="entry.badge.label">{{
                      formatCompactNumber(entry.badge.value)
                    }}</SidebarBadge>
                  </template>
                </SidebarNavItem>
              </SidebarZone>
            </template>
          </template>

          <div v-else-if="isRail" class="flex flex-col items-center gap-1 px-2">
            <template v-for="block in run.blocks" :key="block.id">
              <SidebarSectionPopover
                v-if="block.kind === 'list'"
                :label="block.section.props.label"
                :icon="block.section.icon"
                :count="block.section.props.items.length"
              >
                <SidebarEntitySection v-bind="block.section.props" always-open @add="handleAdd(block.section)" @navigate="handleNavigate" />
              </SidebarSectionPopover>
            </template>
          </div>

          <template v-else>
            <template v-for="block in run.blocks" :key="block.id">
              <SidebarEntitySection
                v-if="block.kind === 'list'"
                v-bind="block.section.props"
                :tour-id="block.section.tourId"
                :can-reorder="block.section.canReorder"
                :persist-order="block.section.persistOrder"
                :activity="block.section.activity"
                @add="handleAdd(block.section)"
                @navigate="handleNavigate"
              />
            </template>
          </template>
        </template>
      </template>
    </SidebarContent>

    <SidebarCustomizeBar v-if="isCustomizing && !isSettingsRoute" />
    <SidebarDock v-else :is-rail="isRail" :is-mobile="isMobile" @navigate="handleNavigate" />
    <SidebarFooterBar v-if="!isSettingsRoute" :is-rail="isRail" @navigate="handleNavigate" />

    <SidebarRail />
  </Sidebar>
</template>
