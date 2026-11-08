<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { HardDrive } from '@lucide/vue'
import type { BookMergeFilePlanEntry } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import type { MergeFileGroup } from '@/features/book/lib/book-merge'
import MergeFileItem from './MergeFileItem.vue'

/** Large audiobooks carry hundreds of tracks; the rest stay one click away. */
const INITIAL_VISIBLE = 40

const props = withDefaults(
  defineProps<{
    files: BookMergeFilePlanEntry[]
    bookLabels: Map<number, string>
    /** Byte total from the `CROSS_DEVICE_COPY` warning, when the server counted it. */
    crossDeviceBytes: number | null
    canRemoveIdenticalCopies: boolean
    deleteIdenticalCopies: boolean
    /** Across libraries: the files by direction, "From Books to Audiobooks". Null shows one flat list. */
    groups?: MergeFileGroup[] | null
    libraryNames?: Map<number, string>
  }>(),
  { groups: null, libraryNames: () => new Map() },
)

const emit = defineEmits<{ 'update:deleteIdenticalCopies': [value: boolean] }>()

const { t } = useI18n()
const showAll = ref(false)
const helpId = `merge-identical-${useId()}`

const orderedFiles = computed(() => (props.groups ? props.groups.flatMap((group) => group.files) : props.files))
const visibleFiles = computed(() => (showAll.value ? orderedFiles.value : orderedFiles.value.slice(0, INITIAL_VISIBLE)))
const hiddenCount = computed(() => orderedFiles.value.length - visibleFiles.value.length)
const hasIdentical = computed(() => orderedFiles.value.some((file) => file.identical))

/** Each group keeps its full count in the heading, and lists only the files not yet folded away. */
const visibleGroups = computed(() => {
  if (!props.groups) return null
  const visible = new Set(visibleFiles.value.map((file) => file.fileId))
  return props.groups
    .map((group) => ({ group, files: group.files.filter((file) => visible.has(file.fileId)) }))
    .filter((entry) => entry.files.length > 0)
})

const crossDeviceSize = computed(() => {
  if (props.crossDeviceBytes !== null) return props.crossDeviceBytes
  const moving = props.files.filter((file) => file.crossDevice && file.action === 'move')
  if (moving.length === 0) return null
  return moving.reduce((total, file) => total + (file.sizeBytes ?? 0), 0)
})

function libraryName(libraryId: number): string {
  return props.libraryNames.get(libraryId) ?? t('book.merge.crossLibrary.unknownLibrary')
}

function groupHeading(group: MergeFileGroup): string {
  const values = { count: group.files.length, size: formatBytes(group.bytes) }
  if (group.fromLibraryId === group.toLibraryId)
    return t('book.merge.crossLibrary.files.within', { ...values, library: libraryName(group.toLibraryId) })
  return t('book.merge.crossLibrary.files.direction', { ...values, from: libraryName(group.fromLibraryId), to: libraryName(group.toLibraryId) })
}

function revealAll(): void {
  showAll.value = true
}

function handleIdenticalChange(event: Event): void {
  emit('update:deleteIdenticalCopies', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="crossDeviceSize !== null && !visibleGroups" class="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-foreground">
      <HardDrive :size="14" class="mt-px shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{{ t('book.merge.files.crossDevice', { size: formatBytes(crossDeviceSize) }) }}</span>
    </p>

    <template v-if="visibleGroups">
      <section v-for="entry in visibleGroups" :key="entry.group.key" class="space-y-1.5" data-testid="merge-file-group">
        <h5 class="text-xs font-semibold break-words text-foreground">{{ groupHeading(entry.group) }}</h5>
        <p v-if="entry.group.crossDeviceBytes > 0" class="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-foreground">
          <HardDrive :size="14" class="mt-px shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{{ t('book.merge.crossLibrary.files.copiedToDrive', { size: formatBytes(entry.group.crossDeviceBytes) }) }}</span>
        </p>
        <ul class="space-y-1.5">
          <MergeFileItem v-for="file in entry.files" :key="file.fileId" :file="file" :book-label="bookLabels.get(file.bookId) ?? null" />
        </ul>
      </section>
    </template>
    <ul v-else class="space-y-1.5">
      <MergeFileItem v-for="file in visibleFiles" :key="file.fileId" :file="file" :book-label="bookLabels.get(file.bookId) ?? null" />
    </ul>

    <button
      v-if="hiddenCount > 0"
      type="button"
      class="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="revealAll"
    >
      {{ t('book.merge.files.showMore', { count: hiddenCount }) }}
    </button>

    <div v-if="canRemoveIdenticalCopies && hasIdentical" class="rounded-md border border-border px-3 py-2.5">
      <label class="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          class="mt-0.5 shrink-0 accent-primary"
          data-testid="merge-remove-identical"
          :checked="deleteIdenticalCopies"
          :aria-describedby="helpId"
          @change="handleIdenticalChange"
        />
        <span class="text-sm font-medium text-foreground">{{ t('book.merge.files.removeIdentical') }}</span>
      </label>
      <p :id="helpId" class="mt-1 ps-6 text-xs text-muted-foreground">{{ t('book.merge.files.removeIdenticalHelp') }}</p>
    </div>
  </div>
</template>
