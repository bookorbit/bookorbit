<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from 'reka-ui'
import { Check, FolderPlus, SlidersHorizontal } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { isAtOrInside, leafName } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import type { TreeSort } from '../../composables/folder-picker/useFolderPickerTree'
import FolderPickerField from './FolderPickerField.vue'

const { t } = useI18n()
const picker = useFolderPickerContext()
const tree = picker.tree
const field = ref<InstanceType<typeof FolderPickerField> | null>(null)

const viewChanged = computed(() => tree.sort.value !== 'name' || tree.hideEmpty.value || tree.showSystem.value)
/** New folders go in the folder in focus, or the first mount that is not BookOrbit's data before anything is focused. */
const target = computed(() => {
  const focus = tree.focus.value
  if (focus && !['denied', 'appData'].includes(picker.selection.status(focus)?.kind ?? '')) return focus
  const places = picker.data.places.value
  return places?.mounts.find((mount) => !places.appDataPath || !isAtOrInside(mount, places.appDataPath)) ?? tree.root.value
})

const outline =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
const iconButton = 'flex size-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted'
const item =
  'flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none hover:bg-muted data-[highlighted]:bg-muted'
const heading = 'px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground'

function onSort(value: unknown) {
  if (value === 'name' || value === 'books') tree.sort.value = value satisfies TreeSort
}

function onShowEmpty(value: boolean | 'indeterminate') {
  tree.hideEmpty.value = value !== true
}

function onShowSystem(value: boolean | 'indeterminate') {
  tree.showSystem.value = value === true
}

function onMenuOpen(open: boolean) {
  picker.menuOpen.value = open
}

function onNewFolder() {
  picker.openNewFolder(target.value)
}

defineExpose({ focusField: (prefill?: string) => field.value?.focus(prefill) })
</script>

<template>
  <div class="flex shrink-0 items-center gap-2 border-b border-border py-2" :class="picker.phone.value ? 'px-2' : 'px-3'">
    <FolderPickerField ref="field" />
    <DropdownMenu :open="picker.menuOpen.value" @update:open="onMenuOpen">
      <DropdownMenuTrigger as-child>
        <button type="button" class="relative" :class="picker.phone.value ? iconButton : outline" :aria-label="t('library.folderBrowser.view.label')">
          <SlidersHorizontal :size="15" aria-hidden="true" />
          <template v-if="!picker.phone.value">{{ t('library.folderBrowser.view.button') }}</template>
          <span v-if="viewChanged" class="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-primary" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" :side-offset="4" class="z-[90] w-64 border-border shadow-lg">
        <p :class="heading">{{ t('library.folderBrowser.view.sort') }}</p>
        <DropdownMenuRadioGroup :model-value="tree.sort.value" @update:model-value="onSort">
          <DropdownMenuRadioItem value="name" :class="item">
            <Check v-if="tree.sort.value === 'name'" :size="15" /><span v-else class="size-[15px]" />{{ t('library.folderBrowser.view.sortName') }}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="books" :class="item">
            <Check v-if="tree.sort.value === 'books'" :size="15" /><span v-else class="size-[15px]" />{{ t('library.folderBrowser.view.sortBooks') }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <div class="my-1 h-px bg-border" />
        <p :class="heading">{{ t('library.folderBrowser.view.show') }}</p>
        <DropdownMenuCheckboxItem :model-value="!tree.hideEmpty.value" :class="item" @update:model-value="onShowEmpty">
          <Check v-if="!tree.hideEmpty.value" :size="15" /><span v-else class="size-[15px]" />{{ t('library.folderBrowser.view.showEmpty') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :model-value="tree.showSystem.value" :class="item" @update:model-value="onShowSystem">
          <Check v-if="tree.showSystem.value" :size="15" /><span v-else class="size-[15px]" />{{ t('library.folderBrowser.view.showSystem') }}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <button
      type="button"
      :class="picker.phone.value ? iconButton : outline"
      :aria-label="t('library.folderBrowser.newFolder.label', { name: leafName(target) })"
      :title="t('library.folderBrowser.newFolder.label', { name: target })"
      @click="onNewFolder"
    >
      <FolderPlus :size="15" aria-hidden="true" />
      <template v-if="!picker.phone.value">{{ t('library.folderBrowser.newFolder.button') }}</template>
    </button>
  </div>
</template>
