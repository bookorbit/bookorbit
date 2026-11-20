<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, ChartColumn, Eye, EyeOff, Info, LayoutDashboard, Library as LibraryIcon, RotateCcw } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { LIBRARY_VISIBILITY_PLACES, Permission, type Library, type LibraryVisibilityPlace } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { formatListParts } from '@/i18n/formatters'
import { useLibraryVisibility } from './composables/useLibraryVisibility'

const { t, locale } = useI18n()
const { libraries, loaded, fetchLibraries } = useLibraries()
const { anyHidden, isHidden, placesHiding, setHidden, showEverywhere } = useLibraryVisibility()
const { hasPermission } = usePermissions()

const PLACE_ICONS = { shelves: LayoutDashboard, series: LibraryIcon, stats: ChartColumn } as const

const places = computed(() =>
  LIBRARY_VISIBILITY_PLACES.map((key) => ({
    key,
    icon: PLACE_ICONS[key],
    label: t(`settings.appearance.libraryVisibility.places.${key}.label`),
    short: t(`settings.appearance.libraryVisibility.places.${key}.short`),
    covers: t(`settings.appearance.libraryVisibility.places.${key}.covers`),
  })),
)

const sortedLibraries = computed(() => [...libraries.value].sort((a, b) => a.name.localeCompare(b.name, locale.value, { sensitivity: 'base' })))

const syncServices = computed(() =>
  [
    { id: 'hardcover', routeName: 'settings-hardcover', label: t('settings.integrations.tabs.hardcover'), permission: Permission.HardcoverSync },
    { id: 'storygraph', routeName: 'settings-storygraph', label: t('settings.integrations.tabs.storygraph'), permission: Permission.StorygraphSync },
  ].filter((service) => hasPermission(service.permission)),
)

const syncTitle = computed(() => joinList(syncServices.value.map((service) => service.label)))

onMounted(() => {
  void fetchLibraries()
})

function joinList(values: string[]): string {
  return formatListParts(values)
    .map((part) => part.value)
    .join('')
}

function hiddenEverywhere(library: Library): boolean {
  return placesHiding(library.id).length === LIBRARY_VISIBILITY_PLACES.length
}

function bookCount(library: Library): string {
  return t('settings.appearance.libraryVisibility.books', { count: library.bookCount ?? 0 })
}

/** The wide layout names every place a library is hidden from; the book count leads. */
function hiddenFromText(library: Library): string {
  const hiddenPlaces = placesHiding(library.id)
  if (hiddenPlaces.length === 0 || hiddenPlaces.length === LIBRARY_VISIBILITY_PLACES.length) return ''
  const names = hiddenPlaces.map((place) => t(`settings.appearance.libraryVisibility.places.${place}.inSentence`))
  return t('settings.appearance.libraryVisibility.hiddenFrom', { places: joinList(names) })
}

/** A narrow row has room for one fact under the name, and where it is hidden beats the book count. */
function compactHiddenText(library: Library): string {
  const hiddenPlaces = placesHiding(library.id)
  if (hiddenPlaces.length === 0) return ''
  if (hiddenPlaces.length === LIBRARY_VISIBILITY_PLACES.length) return t('settings.appearance.libraryVisibility.hiddenEverywhere')
  if (hiddenPlaces.length === 1) {
    return t('settings.appearance.libraryVisibility.hiddenInOne', {
      place: t(`settings.appearance.libraryVisibility.places.${hiddenPlaces[0]}.short`),
    })
  }
  return t('settings.appearance.libraryVisibility.hiddenInMany', { count: hiddenPlaces.length })
}

function toggleLabel(library: Library, placeLabel: string): string {
  return t('settings.appearance.libraryVisibility.toggleLabel', { library: library.name, place: placeLabel })
}

async function toggle(library: Library, place: LibraryVisibilityPlace) {
  if (!(await setHidden(library.id, place, !isHidden(library.id, place)))) toast.error(t('settings.appearance.libraryVisibility.saveFailed'))
}

async function handleShowEverywhere() {
  if (await showEverywhere()) toast.success(t('settings.appearance.libraryVisibility.shownAgain'))
  else toast.error(t('settings.appearance.libraryVisibility.saveFailed'))
}
</script>

<template>
  <div class="@container">
    <p class="mb-3.5 max-w-[62ch] text-[13px] leading-normal text-muted-foreground">
      {{ t('settings.appearance.libraryVisibility.intro') }}
    </p>

    <div class="mb-2 flex items-center justify-between gap-3">
      <p class="settings-group-label mb-0!">{{ t('settings.appearance.libraryVisibility.librariesLabel') }}</p>
      <button
        type="button"
        class="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-[9px] text-xs/normal font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:bg-transparent disabled:text-muted-foreground"
        :disabled="!anyHidden"
        data-testid="library-visibility-reset"
        @click="handleShowEverywhere"
      >
        <RotateCcw class="size-[13px]" aria-hidden="true" />
        {{ t('settings.appearance.libraryVisibility.showEverywhere') }}
      </button>
    </div>

    <div class="settings-card" role="table" :aria-label="t('settings.appearance.libraryVisibility.tableLabel')" data-testid="library-visibility-grid">
      <div
        class="grid min-h-[46px] grid-cols-[minmax(0,1fr)_repeat(3,50px)] items-center gap-x-0.5 bg-card pr-2 pl-3.5 @2xl:grid-cols-[minmax(0,1fr)_repeat(3,128px)] @2xl:gap-x-2 @2xl:pr-4 @2xl:pl-5"
        role="row"
      >
        <div class="text-[11px] font-semibold tracking-[.07em] text-muted-foreground uppercase" role="columnheader">
          {{ t('settings.appearance.libraryVisibility.libraryColumn') }}
        </div>
        <div
          v-for="place in places"
          :key="place.key"
          class="flex min-w-0 flex-col items-center gap-1 pt-[9px] pb-2 text-center @2xl:gap-[3px] @2xl:pt-2 @2xl:pb-[7px]"
          role="columnheader"
        >
          <span
            class="inline-flex flex-col items-center gap-[3px] text-[10.5px] font-semibold whitespace-nowrap text-foreground @2xl:flex-row @2xl:gap-1.5 @2xl:text-xs/normal"
          >
            <component :is="place.icon" class="size-4 shrink-0 text-muted-foreground @2xl:size-3.5" aria-hidden="true" />
            <span class="@2xl:hidden">{{ place.short }}</span>
            <span class="hidden @2xl:inline">{{ place.label }}</span>
          </span>
        </div>
      </div>

      <p v-if="loaded && sortedLibraries.length === 0" class="bg-card px-5 py-4 text-sm text-muted-foreground">
        {{ t('settings.appearance.libraryVisibility.noLibraries') }}
      </p>

      <div
        v-for="library in sortedLibraries"
        :key="library.id"
        class="grid min-h-14 grid-cols-[minmax(0,1fr)_repeat(3,50px)] items-center gap-x-0.5 bg-card pr-2 pl-3.5 transition-colors hover:bg-muted/45 @2xl:min-h-[52px] @2xl:grid-cols-[minmax(0,1fr)_repeat(3,128px)] @2xl:gap-x-2 @2xl:pr-4 @2xl:pl-5"
        role="row"
        :data-testid="`library-visibility-row-${library.id}`"
      >
        <div class="flex min-w-0 items-center gap-2.5 py-2 @2xl:gap-[11px]" role="rowheader">
          <span class="grid size-[30px] shrink-0 place-items-center rounded-[8px] border border-border bg-background text-foreground">
            <AppIcon :icon="library.icon" :fallback="LibraryIcon" :size="15" aria-hidden="true" />
          </span>
          <span class="min-w-0">
            <span class="block truncate text-sm/normal font-medium" :class="hiddenEverywhere(library) ? 'text-muted-foreground' : 'text-foreground'">
              {{ library.name }}
              <span
                v-if="hiddenEverywhere(library)"
                class="ms-2 hidden rounded-full bg-primary/14 px-[7px] py-px align-[1px] text-[11px] font-medium text-primary @2xl:inline-flex"
              >
                {{ t('settings.appearance.libraryVisibility.hiddenEverywhere') }}
              </span>
            </span>
            <span class="mt-px block truncate text-xs/normal text-muted-foreground tabular-nums">
              <span class="hidden @2xl:inline">
                {{ bookCount(library)
                }}<template v-if="hiddenFromText(library)">
                  · <span class="text-foreground">{{ hiddenFromText(library) }}</span></template
                >
              </span>
              <span class="@2xl:hidden">
                <span v-if="compactHiddenText(library)" class="text-foreground">{{ compactHiddenText(library) }}</span>
                <template v-else>{{ bookCount(library) }}</template>
              </span>
            </span>
          </span>
        </div>
        <div v-for="place in places" :key="place.key" class="grid min-h-10 place-items-center" role="cell">
          <button
            type="button"
            class="inline-flex h-9 w-11 items-center justify-center gap-1.5 rounded-[7px] border border-border bg-background p-0 text-xs font-medium text-foreground transition-colors not-aria-pressed:hover:bg-[color-mix(in_oklch,var(--muted)_70%,var(--background))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-primary/45 aria-pressed:bg-primary/14 aria-pressed:text-primary @2xl:h-[30px] @2xl:w-auto @2xl:min-w-[92px] @2xl:px-2.5"
            :aria-pressed="isHidden(library.id, place.key)"
            :aria-label="toggleLabel(library, place.label)"
            :data-testid="`library-visibility-toggle-${library.id}-${place.key}`"
            @click="toggle(library, place.key)"
          >
            <EyeOff v-if="isHidden(library.id, place.key)" class="size-4 shrink-0 @2xl:size-3.5" aria-hidden="true" />
            <Eye v-else class="size-4 shrink-0 @2xl:size-3.5" aria-hidden="true" />
            <span class="hidden @2xl:inline">{{
              isHidden(library.id, place.key) ? t('settings.appearance.libraryVisibility.hidden') : t('settings.appearance.libraryVisibility.shown')
            }}</span>
          </button>
        </div>
      </div>
    </div>

    <ul class="mx-0.5 mt-3 grid gap-1.5 text-xs leading-[1.45] text-muted-foreground">
      <li v-for="place in places" :key="place.key" class="flex items-baseline gap-2">
        <component :is="place.icon" class="relative top-0.5 size-[13px] shrink-0" aria-hidden="true" />
        <span
          ><b class="font-semibold text-foreground">{{ t('settings.appearance.libraryVisibility.legendLabel', { place: place.label }) }}</b>
          {{ place.covers }}</span
        >
      </li>
      <li class="flex items-baseline gap-2">
        <Info class="relative top-0.5 size-[13px] shrink-0" aria-hidden="true" />
        <span>{{ t('settings.appearance.libraryVisibility.newLibraries') }}</span>
      </li>
    </ul>

    <template v-if="syncServices.length > 0">
      <p class="settings-group-label mt-7">{{ t('settings.appearance.libraryVisibility.syncLabel') }}</p>
      <div class="settings-card">
        <div class="flex flex-col items-stretch gap-3 bg-card px-4 py-3.5 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:px-5">
          <div class="min-w-0">
            <p class="settings-label">{{ syncTitle }}</p>
            <p class="settings-hint">
              {{
                syncServices.length > 1 ? t('settings.appearance.libraryVisibility.syncHint') : t('settings.appearance.libraryVisibility.syncHintOne')
              }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <RouterLink
              v-for="service in syncServices"
              :key="service.id"
              :to="{ name: service.routeName }"
              class="inline-flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-border bg-background px-[11px] text-[13px] font-medium text-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_70%,var(--background))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @2xl:h-8 @2xl:flex-none"
            >
              {{ service.label }}
              <ArrowUpRight class="size-3.5 text-muted-foreground" aria-hidden="true" />
            </RouterLink>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
