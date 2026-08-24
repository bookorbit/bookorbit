<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FileEdit, Images, MoreHorizontal, Pencil, RefreshCw, Trash2 } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{ library: Library; scanning: boolean; refreshingCovers: boolean; syncingFiles: boolean }>()

const emit = defineEmits<{
  scan: [library: Library]
  edit: [library: Library]
  refreshCovers: [library: Library]
  syncFiles: [library: Library]
  remove: [library: Library]
}>()

const { t } = useI18n()

function requestScan() {
  emit('scan', props.library)
}
function requestEdit() {
  emit('edit', props.library)
}
function requestRefreshCovers() {
  emit('refreshCovers', props.library)
}
function requestSyncFiles() {
  emit('syncFiles', props.library)
}
function requestRemove() {
  emit('remove', props.library)
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <Button variant="outline" size="sm" type="button" :disabled="scanning" @click="requestScan">
      <RefreshCw :size="14" :class="scanning ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
      {{ scanning ? t('settings.admin.libraries.scanning') : t('settings.admin.libraries.scan') }}
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" size="icon-sm" type="button" :aria-label="t('settings.admin.libraries.moreActions', { name: library.name })">
          <MoreHorizontal :size="16" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-52">
        <DropdownMenuItem @click="requestEdit">
          <Pencil />
          {{ t('settings.admin.libraries.editLibrary') }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="refreshingCovers" @click="requestRefreshCovers">
          <Images :class="refreshingCovers ? 'animate-pulse motion-reduce:animate-none' : ''" />
          {{ t('settings.admin.libraries.refreshCovers') }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="syncingFiles || !library.fileWriteEnabled" @click="requestSyncFiles">
          <FileEdit :class="syncingFiles ? 'animate-pulse motion-reduce:animate-none' : ''" />
          <span class="flex-1">{{ t('settings.admin.libraries.syncMetadataToFiles') }}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" @click="requestRemove">
          <Trash2 />
          {{ t('settings.admin.libraries.deleteLibrary') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
