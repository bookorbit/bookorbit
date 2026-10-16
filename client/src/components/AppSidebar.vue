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
import { useSidebarDataSync } from '@/composables/useSidebarDataSync'
import { useSidebarNav } from '@/composables/useSidebarNav'
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
const { state, isMobile, setOpenMobile } = useSidebar()
const { mode, setMode, syncModeFromRoute } = useMediaMode()
const { outstandingRequestTotal } = useSidebarDataSync()
const { zones } = useSidebarNav(() => outstandingRequestTotal.value)
const { sections, podcastLibraries, podcastsAvailable } = useSidebarSections()
const { subscribe: subscribeLibraryActivity } = useSidebarLibraryActivity()
const { handleLibraryCreated } = useLibraryCreationRedirect()

const isRail = computed(() => state.value === 'collapsed' && !isMobile.value)
const isSettingsRoute = computed(() => typeof route.name === 'string' && route.name.startsWith('settings-'))
/** Reading sits below the libraries and lists; everything else stays above them. */
const topZones = computed(() => zones.value.filter((zone) => zone.id !== 'reading'))
const bottomZones = computed(() => zones.value.filter((zone) => zone.id === 'reading'))

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

      <template v-else>
        <!-- Fixed destinations come first: they are a known height, so the variable-length
             entity sections below can never push them out of the first screenful. -->
        <SidebarZone
          v-for="zone in topZones"
          :key="zone.id"
          :label="zone.labelKey ? t(zone.labelKey) : null"
          :section-id="zone.sectionId ?? undefined"
          :always-open="isRail"
        >
          <SidebarSearchItem v-if="zone.id === 'primary'" />
          <SidebarNavItem
            v-for="entry in zone.entries"
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

        <SidebarSeparator />

        <div v-if="isRail" class="flex flex-col items-center gap-1 px-2">
          <SidebarSectionPopover
            v-for="section in sections"
            :key="section.id"
            :label="section.props.label"
            :icon="section.icon"
            :count="section.props.items.length"
          >
            <SidebarEntitySection v-bind="section.props" always-open @add="handleAdd(section)" @navigate="handleNavigate" />
          </SidebarSectionPopover>
        </div>

        <template v-else>
          <SidebarEntitySection
            v-for="section in sections"
            :key="section.id"
            v-bind="section.props"
            :tour-id="section.tourId"
            :can-reorder="section.canReorder"
            :persist-order="section.persistOrder"
            :activity="section.activity"
            @add="handleAdd(section)"
            @navigate="handleNavigate"
          />
        </template>

        <template v-if="bottomZones.length">
          <SidebarSeparator />
          <SidebarZone
            v-for="zone in bottomZones"
            :key="zone.id"
            :label="zone.labelKey ? t(zone.labelKey) : null"
            :section-id="zone.sectionId ?? undefined"
            :always-open="isRail"
          >
            <SidebarNavItem
              v-for="entry in zone.entries"
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
    </SidebarContent>

    <SidebarDock :is-rail="isRail" :is-mobile="isMobile" @navigate="handleNavigate" />
    <SidebarFooterBar v-if="!isSettingsRoute" :is-rail="isRail" @navigate="handleNavigate" />

    <SidebarRail />
  </Sidebar>
</template>
