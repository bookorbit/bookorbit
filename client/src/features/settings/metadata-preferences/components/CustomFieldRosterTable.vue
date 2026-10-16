<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, GripVertical, Info, Loader2, MoreVertical, Pencil, Trash2 } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { CustomMetadataFieldDefinition, Library } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDateTime, formatNumber, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { fieldCoverage } from '../lib/custom-field-coverage'
import CustomFieldCoverage from './CustomFieldCoverage.vue'
import CustomFieldLibrarySummary from './CustomFieldLibrarySummary.vue'
import CustomFieldTypeChip from './CustomFieldTypeChip.vue'

const props = defineProps<{
  fields: CustomMetadataFieldDefinition[]
  view: 'active' | 'archived'
  libraries: Library[]
  /** Off while searching, since a filtered list cannot say where a dropped row lands. */
  canReorder: boolean
  restoringId: number | null
}>()

const emit = defineEmits<{
  open: [field: CustomMetadataFieldDefinition]
  archive: [field: CustomMetadataFieldDefinition]
  restore: [field: CustomMetadataFieldDefinition]
  delete: [field: CustomMetadataFieldDefinition]
  move: [field: CustomMetadataFieldDefinition, step: -1 | 1]
  reorder: [orderedIds: number[]]
}>()

const { t } = useI18n()

const rows = ref<CustomMetadataFieldDefinition[]>([])
watch(
  () => props.fields,
  (value) => (rows.value = [...value]),
  { immediate: true },
)

function openField(field: CustomMetadataFieldDefinition) {
  emit('open', field)
}

function archiveField(field: CustomMetadataFieldDefinition) {
  emit('archive', field)
}

function restoreField(field: CustomMetadataFieldDefinition) {
  emit('restore', field)
}

function deleteField(field: CustomMetadataFieldDefinition) {
  emit('delete', field)
}

function moveUp(field: CustomMetadataFieldDefinition) {
  emit('move', field, -1)
}

function moveDown(field: CustomMetadataFieldDefinition) {
  emit('move', field, 1)
}

function handleDragEnd() {
  emit(
    'reorder',
    rows.value.map((field) => field.id),
  )
}

function coverageOf(field: CustomMetadataFieldDefinition) {
  return fieldCoverage(field, props.libraries)
}
</script>

<template>
  <div class="hidden rounded-lg border border-border bg-card shadow-xs md:block">
    <table class="w-full table-fixed text-sm">
      <colgroup v-if="view === 'active'">
        <col class="w-10" />
        <col />
        <col class="w-32" />
        <col class="w-[30%]" />
        <col class="w-[10.5rem]" />
        <col class="w-28" />
      </colgroup>
      <colgroup v-else>
        <col />
        <col class="w-32" />
        <col class="w-[22%]" />
        <col class="w-[11.25rem]" />
        <col class="w-[9.75rem]" />
      </colgroup>
      <thead class="bg-foreground/3">
        <tr v-if="view === 'active'">
          <th scope="col">
            <span class="sr-only">{{ t('settings.metadata.customFields.columns.order') }}</span>
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.field') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.type') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.libraries') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.filled') }}
          </th>
          <th scope="col">
            <span class="sr-only">{{ t('settings.metadata.customFields.columns.actions') }}</span>
          </th>
        </tr>
        <tr v-else>
          <th scope="col" class="px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.field') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.type') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.valuesKept') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.metadata.customFields.columns.archived') }}
          </th>
          <th scope="col">
            <span class="sr-only">{{ t('settings.metadata.customFields.columns.actions') }}</span>
          </th>
        </tr>
      </thead>

      <VueDraggable
        v-if="view === 'active'"
        v-model="rows"
        tag="tbody"
        class="divide-y divide-border"
        :animation="150"
        handle=".custom-field-handle"
        ghost-class="opacity-40"
        :disabled="!canReorder"
        @end="handleDragEnd"
      >
        <tr
          v-for="(field, index) in rows"
          :key="field.id"
          class="group cursor-pointer bg-card transition-colors hover:bg-foreground/4 focus-within:bg-foreground/4"
          :class="field.enabledLibraryIds.length === 0 ? 'shadow-[inset_2px_0_0_var(--pill-warning)]' : ''"
          @click="openField(field)"
        >
          <td class="ps-2" @click.stop>
            <button
              type="button"
              class="custom-field-handle grid h-7 w-5 cursor-grab place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-(--shell-accent-wash) hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="!canReorder"
              :title="canReorder ? t('settings.metadata.customFields.dragToReorder') : t('settings.metadata.customFields.clearSearchToReorder')"
              :aria-label="t('settings.metadata.customFields.dragToReorderField')"
            >
              <GripVertical :size="15" aria-hidden="true" />
            </button>
          </td>
          <td class="px-3 py-2.5">
            <span class="block truncate font-semibold text-foreground">{{ field.label }}</span>
          </td>
          <td class="px-3 py-2.5"><CustomFieldTypeChip :type="field.type" /></td>
          <td class="overflow-hidden px-3 py-2.5">
            <CustomFieldLibrarySummary :library-ids="field.enabledLibraryIds" :libraries="libraries" />
          </td>
          <td class="px-3 py-2.5"><CustomFieldCoverage :coverage="coverageOf(field)" /></td>
          <td class="px-3 py-2" @click.stop>
            <div class="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                @click="openField(field)"
              >
                <Pencil :size="14" aria-hidden="true" />
                {{ t('settings.metadata.customFields.rowActions.edit') }}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    :aria-label="t('settings.metadata.customFields.rowActions.more', { label: field.label })"
                  >
                    <MoreVertical :size="16" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-52">
                  <DropdownMenuItem @click="openField(field)">
                    <Pencil aria-hidden="true" />
                    {{ t('settings.metadata.customFields.rowActions.editField') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem :disabled="!canReorder || index === 0" @click="moveUp(field)">
                    <ChevronUp aria-hidden="true" />
                    {{ t('settings.metadata.customFields.rowActions.moveUp') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem :disabled="!canReorder || index === rows.length - 1" @click="moveDown(field)">
                    <ChevronDown aria-hidden="true" />
                    {{ t('settings.metadata.customFields.rowActions.moveDown') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="archiveField(field)">
                    <Archive aria-hidden="true" />
                    {{ t('settings.metadata.customFields.rowActions.archive') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </td>
        </tr>
      </VueDraggable>

      <tbody v-else class="divide-y divide-border">
        <tr
          v-for="field in rows"
          :key="field.id"
          class="group cursor-pointer bg-card transition-colors hover:bg-foreground/4 focus-within:bg-foreground/4"
          @click="openField(field)"
        >
          <td class="px-4 py-2.5">
            <span class="block truncate font-semibold text-foreground">{{ field.label }}</span>
          </td>
          <td class="px-3 py-2.5"><CustomFieldTypeChip :type="field.type" /></td>
          <td class="px-3 py-2.5 tabular-nums" :class="field.usageCount ? 'text-foreground' : 'text-muted-foreground'">
            {{ field.usageCount ? formatNumber(field.usageCount) : t('settings.metadata.customFields.noValues') }}
          </td>
          <td class="px-3 py-2.5 text-muted-foreground" :title="field.archivedAt ? formatDateTime(new Date(field.archivedAt)) : undefined">
            {{ field.archivedAt ? formatRelativeTimeFromNow(field.archivedAt) : '' }}
          </td>
          <td class="px-3 py-2" @click.stop>
            <div class="flex items-center justify-end gap-1">
              <Button variant="outline" size="sm" type="button" :disabled="restoringId === field.id" @click="restoreField(field)">
                <Loader2 v-if="restoringId === field.id" :size="14" class="animate-spin" aria-hidden="true" />
                <ArchiveRestore v-else :size="14" aria-hidden="true" />
                {{ t('settings.metadata.customFields.rowActions.restore') }}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    :aria-label="t('settings.metadata.customFields.rowActions.more', { label: field.label })"
                  >
                    <MoreVertical :size="16" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-56">
                  <DropdownMenuItem variant="destructive" @click="deleteField(field)">
                    <Trash2 aria-hidden="true" />
                    {{ t('settings.metadata.customFields.rowActions.deletePermanently') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <p class="flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <GripVertical v-if="view === 'active'" :size="13" aria-hidden="true" />
      <Info v-else :size="13" aria-hidden="true" />
      {{ view === 'active' ? t('settings.metadata.customFields.orderHint') : t('settings.metadata.customFields.archivedHint') }}
    </p>
  </div>
</template>
