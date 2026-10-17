<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FileUp, MoreHorizontal, Pencil, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** A family row's overflow menu. Removal is listed last and asks in the family sheet before it runs. */
const props = defineProps<{ name: string }>()

const emit = defineEmits<{ rename: [name: string]; addFiles: []; remove: [name: string] }>()

const { t } = useI18n()

function handleRename() {
  emit('rename', props.name)
}
function handleAddFiles() {
  emit('addFiles')
}
function handleRemove() {
  emit('remove', props.name)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" size="icon-sm" type="button" :aria-label="t('settings.admin.serverFonts.moreActions', { name })">
        <MoreHorizontal :size="16" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-52">
      <DropdownMenuItem @click="handleRename">
        <Pencil />
        {{ t('settings.admin.serverFonts.menu.rename') }}
      </DropdownMenuItem>
      <DropdownMenuItem @click="handleAddFiles">
        <FileUp />
        {{ t('settings.admin.serverFonts.menu.addFiles') }}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" @click="handleRemove">
        <Trash2 />
        {{ t('settings.admin.serverFonts.menu.remove') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
