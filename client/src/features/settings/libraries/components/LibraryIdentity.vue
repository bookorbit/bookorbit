<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, Folder } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortenPath } from '../lib/library-paths'

const props = withDefaults(defineProps<{ library: Library; prominent?: boolean }>(), { prominent: false })

const { t } = useI18n()

const isFileMode = computed(() => props.library.organizationMode === 'book_per_file')
const modeIcon = computed(() => (isFileMode.value ? FileText : Folder))
const modeLabel = computed(() => (isFileMode.value ? t('settings.admin.libraries.fileMode') : t('settings.admin.libraries.folderMode')))

const firstFolder = computed(() => props.library.folders[0]?.path ?? null)
const extraFolders = computed(() => Math.max(0, props.library.folders.length - 1))
const allPaths = computed(() => props.library.folders.map((folder) => folder.path).join('\n'))

/** The ledger row has room for the whole path; the mobile card keeps the identifying tail. */
const displayPath = computed(() => {
  if (!firstFolder.value) return ''
  return props.prominent ? firstFolder.value : shortenPath(firstFolder.value)
})
</script>

<template>
  <div class="flex min-w-0 items-center" :class="prominent ? 'gap-3' : 'gap-2.5'">
    <RouterLink
      :to="{ name: 'library', params: { id: library.id } }"
      class="flex shrink-0 items-center justify-center bg-primary/10 transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="prominent ? 'size-10 rounded-xl' : 'size-8 rounded-lg'"
      :aria-label="t('settings.admin.libraries.openLibrary', { name: library.name })"
    >
      <AppIcon :icon="library.icon || 'FolderOpen'" fallback="FolderOpen" :size="prominent ? 19 : 15" class="text-primary" />
    </RouterLink>
    <div class="min-w-0">
      <RouterLink
        :to="{ name: 'library', params: { id: library.id } }"
        class="block truncate font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="prominent ? 'text-[17px] tracking-tight' : 'text-sm font-medium'"
      >
        {{ library.name }}
      </RouterLink>

      <p class="flex min-w-0 items-center gap-2 text-muted-foreground" :class="prominent ? 'mt-1.5 text-[12.5px]' : 'mt-0.5 text-xs'">
        <span
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
          :class="
            isFileMode
              ? 'border-[var(--pill-file-as-book)]/40 bg-[var(--pill-file-as-book)]/12 text-[var(--pill-file-as-book)]'
              : 'border-[var(--pill-folder-as-book)]/40 bg-[var(--pill-folder-as-book)]/12 text-[var(--pill-folder-as-book)]'
          "
        >
          <component :is="modeIcon" :size="11" class="shrink-0" aria-hidden="true" />
          {{ modeLabel }}
        </span>
        <template v-if="prominent">
          <span class="shrink-0">{{ t('settings.admin.libraries.folderCount', { count: library.folders.length }) }}</span>
        </template>
        <template v-else-if="firstFolder">
          <span class="shrink-0 opacity-50" aria-hidden="true">&middot;</span>
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="min-w-0 truncate font-mono" dir="ltr" :title="allPaths">{{ displayPath }}</span>
            </TooltipTrigger>
            <TooltipContent class="max-w-sm">
              <p v-for="folder in library.folders" :key="folder.id" dir="ltr" class="break-all font-mono text-xs">{{ folder.path }}</p>
            </TooltipContent>
          </Tooltip>
          <span v-if="extraFolders > 0" class="shrink-0">{{ t('settings.admin.libraries.extraFolders', { count: extraFolders }) }}</span>
        </template>
      </p>

      <p v-if="prominent && firstFolder" class="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Folder :size="12" class="shrink-0 opacity-60" aria-hidden="true" />
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="min-w-0 truncate font-mono" dir="ltr" :title="allPaths">{{ displayPath }}</span>
          </TooltipTrigger>
          <TooltipContent class="max-w-sm">
            <p v-for="folder in library.folders" :key="folder.id" dir="ltr" class="break-all font-mono text-xs">{{ folder.path }}</p>
          </TooltipContent>
        </Tooltip>
        <span v-if="extraFolders > 0" class="shrink-0 whitespace-nowrap">
          {{ t('settings.admin.libraries.extraFolders', { count: extraFolders }) }}
        </span>
      </p>
    </div>
  </div>
</template>
