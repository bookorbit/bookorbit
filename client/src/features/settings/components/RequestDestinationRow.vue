<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import type { BookRequestMediaKind, Library, RequestDestination } from '@bookorbit/types'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  mediaKind: BookRequestMediaKind
  libraries: Library[]
  destination: RequestDestination
}>()

const emit = defineEmits<{ update: [mediaKind: BookRequestMediaKind, destination: RequestDestination] }>()

const { t } = useI18n()

const selectedLibrary = computed(() => props.libraries.find((library) => library.id === props.destination.libraryId) ?? null)
const folders = computed(() => selectedLibrary.value?.folders ?? [])

/**
 * A default set by an operator who can reach more libraries than this one can.
 *
 * The select has no option matching the stored id, so it rendered blank and read as "no default" -
 * one keystroke away from an operator helpfully setting the destination to something they can see
 * and silently rerouting every request of that medium. A disabled placeholder says what is
 * actually stored instead, and is not something they can pick.
 */
const libraryIsHidden = computed(() => props.destination.libraryId !== null && selectedLibrary.value === null)
const folderIsHidden = computed(
  () => props.destination.folderId !== null && !folders.value.some((folder) => folder.id === props.destination.folderId),
)

/**
 * A select cuts a long path off at its end, which is the only part that differs when every folder
 * sits under the same root: three rows all reading `/path/to/library/p...` name nothing.
 * The last two segments are what the operator recognises, and the full path stays on hover.
 */
function folderLabel(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments.length > 2 ? `.../${segments.slice(-2).join('/')}` : path
}

/**
 * Changing the library takes its first folder rather than keeping the one on screen: a folder from
 * the previous library would file every request of this medium into that library instead.
 */
function handleLibraryChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const libraryId = value === '' ? null : Number(value)
  const folderId = props.libraries.find((library) => library.id === libraryId)?.folders?.[0]?.id ?? null
  emit('update', props.mediaKind, { libraryId, folderId })
}

function handleFolderChange(event: Event) {
  emit('update', props.mediaKind, { libraryId: props.destination.libraryId, folderId: Number((event.target as HTMLSelectElement).value) })
}

function handleClear() {
  emit('update', props.mediaKind, { libraryId: null, folderId: null })
}
</script>

<template>
  <div class="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
    <span class="text-xs font-medium text-foreground sm:pb-2">{{ t(`bookRequests.mediaKind.${mediaKind}`) }}</span>

    <label class="block">
      <span class="sr-only">{{
        t('settings.system.requests.automation.destinationLibraryFor', { medium: t(`bookRequests.mediaKind.${mediaKind}`) })
      }}</span>
      <select class="select-field w-full" :value="destination.libraryId ?? ''" @change="handleLibraryChange">
        <option value="">{{ t('settings.system.requests.automation.destinationUnset') }}</option>
        <option v-if="libraryIsHidden" :value="destination.libraryId" disabled>
          {{ t('settings.system.requests.automation.destinationHiddenLibrary') }}
        </option>
        <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
      </select>
    </label>

    <label class="block">
      <span class="sr-only">{{
        t('settings.system.requests.automation.destinationFolderFor', { medium: t(`bookRequests.mediaKind.${mediaKind}`) })
      }}</span>
      <select class="select-field w-full" :value="destination.folderId ?? ''" :disabled="destination.libraryId === null" @change="handleFolderChange">
        <option value="" disabled>{{ t('settings.system.requests.automation.selectFolder') }}</option>
        <option v-if="folderIsHidden" :value="destination.folderId" disabled>
          {{ t('settings.system.requests.automation.destinationHiddenFolder') }}
        </option>
        <option v-for="folder in folders" :key="folder.id" :value="folder.id" :title="folder.path">{{ folderLabel(folder.path) }}</option>
      </select>
    </label>

    <Button
      variant="ghost"
      size="icon-sm"
      class="justify-self-start sm:justify-self-auto"
      :disabled="destination.libraryId === null"
      :aria-label="t('settings.system.requests.automation.destinationClearFor', { medium: t(`bookRequests.mediaKind.${mediaKind}`) })"
      @click="handleClear"
    >
      <X :size="15" aria-hidden="true" />
    </Button>
  </div>
</template>
