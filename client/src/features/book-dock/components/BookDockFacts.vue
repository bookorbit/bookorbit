<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy, Folder, FolderOpen, FolderX, GitMerge, Inbox, Link, Loader2, MoveRight, Power, PowerOff, Settings, Sprout } from '@lucide/vue'
import type { LibraryDockFiling } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { updateLibraryDock } from '../api/book-dock.api'
import type { LibraryDockView } from '../composables/useLibraryDocks'

const props = defineProps<{
  /** The library dock shown, or null for Unsorted. */
  dock: LibraryDockView | null
  /** The Book Dock folder, which is Unsorted's drop folder. */
  rootPath: string | null
  filing: LibraryDockFiling | undefined
  keptForSeeding: number
}>()

const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const turningOn = ref(false)
const turnOnFailed = ref(false)

const entry = computed(() => props.dock?.entry ?? null)
const dockRow = computed(() => entry.value?.dock ?? null)
const effective = computed(() => entry.value?.effective ?? null)

const targetFolderPath = computed(() => {
  const folderId = dockRow.value?.targetFolderId
  if (folderId == null) return null
  return entry.value?.folders.find((folder) => folder.id === folderId)?.path ?? null
})

const folderRemoved = computed(() => dockRow.value !== null && dockRow.value.targetFolderId === null)

/** A keep-original dock is probed with a hardlink, so a dock where that works hardlinks. */
const filingFact = computed(() => {
  if (!props.filing || props.filing === 'unknown') return null
  if (props.filing === 'copy')
    return {
      label: t('bookDock.facts.copies'),
      icon: Copy,
      tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      hint: t('bookDock.facts.copiesHint'),
    }
  if (dockRow.value?.keepOriginal)
    return { label: t('bookDock.facts.hardlinks'), icon: Link, tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', hint: '' }
  return { label: t('bookDock.facts.moves'), icon: MoveRight, tone: 'bg-muted text-muted-foreground', hint: '' }
})

async function turnOn() {
  if (!props.dock || turningOn.value) return
  turningOn.value = true
  turnOnFailed.value = false
  const result = await updateLibraryDock(props.dock.libraryId, { enabled: true })
  turningOn.value = false
  if (result.ok) emit('changed')
  else turnOnFailed.value = true
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div data-testid="book-dock-facts" class="flex min-h-6 flex-wrap items-center gap-1.5">
      <template v-if="props.dock === null">
        <span
          v-if="props.rootPath"
          class="inline-flex h-6 items-center gap-1.5 rounded-full border border-border ps-[7px] pe-2.5 text-[11.5px] font-medium text-foreground"
        >
          <Inbox class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="font-mono">{{ props.rootPath }}</span>
        </span>
        <span class="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-[11.5px] font-medium text-muted-foreground">{{
          t('bookDock.facts.defaultSettings')
        }}</span>
      </template>
      <template v-else-if="dockRow">
        <span
          class="inline-flex h-6 items-center gap-1.5 rounded-full border border-border ps-[7px] pe-2.5 text-[11.5px] font-medium text-foreground"
          :title="t('bookDock.facts.dropHint', { library: props.dock.libraryName })"
        >
          <Folder class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="font-mono">_libraries/{{ dockRow.folderName }}</span>
        </span>
        <span
          v-if="targetFolderPath"
          class="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-2.5 text-[11.5px] font-medium text-foreground"
          :title="targetFolderPath"
        >
          <span class="shrink-0 whitespace-nowrap font-normal text-muted-foreground">{{ t('bookDock.facts.filesInto') }}</span>
          <span class="truncate font-mono">{{ targetFolderPath }}</span>
        </span>
        <span
          v-if="effective?.autoFinalizeEnabled"
          class="inline-flex h-6 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-300"
        >
          <Check class="size-3" aria-hidden="true" />
          {{ t('bookDock.facts.autoFileAt', { threshold: effective.autoFinalizeThreshold }) }}
        </span>
        <span v-else class="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11.5px] font-medium text-muted-foreground">
          <PowerOff class="size-3" aria-hidden="true" />
          {{ t('bookDock.facts.autoFileOff') }}
        </span>
        <span
          v-if="filingFact"
          data-testid="book-dock-facts-filing"
          class="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium"
          :class="filingFact.tone"
          :title="filingFact.hint || undefined"
        >
          <component :is="filingFact.icon" class="size-3" aria-hidden="true" />
          {{ filingFact.label }}
        </span>
        <span
          v-if="dockRow.keepOriginal"
          class="inline-flex h-6 items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 text-[11.5px] font-medium text-violet-700 dark:text-violet-300"
        >
          <Sprout class="size-3" aria-hidden="true" />
          {{ t('bookDock.facts.keepsOriginals') }}
        </span>
        <span
          v-if="dockRow.autoJoin"
          class="inline-flex h-6 items-center gap-1.5 rounded-full bg-teal-500/15 px-2.5 text-[11.5px] font-medium text-teal-700 dark:text-teal-300"
        >
          <GitMerge class="size-3" aria-hidden="true" />
          {{ t('bookDock.facts.joinsBooks') }}
        </span>
      </template>
      <span
        v-if="props.keptForSeeding > 0"
        data-testid="book-dock-facts-kept"
        class="inline-flex h-6 items-center gap-1.5 px-2 text-xs font-medium text-foreground"
      >
        <Sprout class="size-3.5 text-muted-foreground" aria-hidden="true" />
        {{ t('bookDock.facts.keptForSeeding', { count: props.keptForSeeding, formatted: formatNumber(props.keptForSeeding) }) }}
      </span>
      <RouterLink
        :to="{ name: 'settings-admin-book-dock' }"
        class="ms-auto inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings class="size-[13px] text-muted-foreground" aria-hidden="true" />
        {{ t('bookDock.facts.dockSettings') }}
      </RouterLink>
    </div>

    <div
      v-if="props.dock && !props.dock.enabled"
      role="status"
      data-testid="book-dock-strip-off"
      class="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-border bg-card py-2 ps-3 pe-2 text-[13px] text-foreground"
    >
      <PowerOff class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p class="min-w-0 flex-1">
        <span class="font-semibold">{{ t('bookDock.strip.offTitle', { library: props.dock.libraryName }) }}</span>
        {{ t('bookDock.strip.offBody', { folder: `_libraries/${dockRow?.folderName ?? ''}` }) }}
        <span v-if="turnOnFailed" class="text-red-600 dark:text-red-400">{{ t('bookDock.strip.turnOnFailed') }}</span>
      </p>
      <button
        type="button"
        data-testid="book-dock-strip-turn-on"
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        :disabled="turningOn"
        @click="turnOn"
      >
        <Loader2 v-if="turningOn" class="size-3.5 animate-spin" aria-hidden="true" />
        <Power v-else class="size-3.5" aria-hidden="true" />
        {{ t('bookDock.strip.turnOn') }}
      </button>
    </div>

    <div
      v-else-if="folderRemoved && props.dock"
      role="status"
      data-testid="book-dock-strip-folder"
      class="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-amber-500/35 bg-amber-500/7 py-2 ps-3 pe-2 text-[13px] text-foreground"
    >
      <FolderX class="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <p class="min-w-0 flex-1">
        <span class="font-semibold">{{ t('bookDock.strip.folderTitle', { library: props.dock.libraryName }) }}</span>
        {{ t('bookDock.strip.folderBody') }}
      </p>
      <RouterLink
        :to="{ name: 'settings-admin-book-dock', query: { dock: String(props.dock.libraryId) } }"
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FolderOpen class="size-3.5" aria-hidden="true" />
        {{ t('bookDock.strip.chooseFolder') }}
      </RouterLink>
    </div>
  </div>
</template>
