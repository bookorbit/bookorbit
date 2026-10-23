<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EyeOff, FileUp, MoreHorizontal, Pencil, Trash2, TriangleAlert } from '@lucide/vue'
import type { FontScope, FontStyle, UserFont } from '@bookorbit/types'
import { FONT_WEIGHTS, fontCssFamilyGroupName, isVariableFont } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { FontFamily } from '@/features/reader/epub/composables/useCustomFonts'
import { FONT_WEIGHT_LABEL_KEYS, familyVariants, fontVariantLabel } from '@/features/reader/shared/lib/font-variants'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsEditorSheet from '../../components/SettingsEditorSheet.vue'
import { useFontLabels } from '../composables/useFontLabels'
import type { FamilyUse } from '../composables/useFontLibrary'
import FontPagePreview, { type PreviewPaper } from './FontPagePreview.vue'
import ReaderFontPickerPreview from './ReaderFontPickerPreview.vue'

/**
 * One family, previewed and managed. `server` is an administrator looking after the shared
 * collection; `own` is a reader looking after their own fonts, or (in `view` mode) looking at a
 * server font they can only show or hide.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    family: FontFamily | null
    scope: FontScope
    perspective: 'server' | 'own'
    mode?: 'edit' | 'view'
    usage: FamilyUse
    /** The families a reader's font list offers, for the copy of it. */
    pickerServerFamilies: FontFamily[]
    pickerUserFamilies?: FontFamily[]
    totalFiles: number
    maxFiles: number
    readonly: boolean
    busy: boolean
    /** Opens with "Remove family" already asked, for the row menu's entry of the same name. */
    armRemove?: boolean
    /** Opens with the name field focused, for the row menu's "Rename family". */
    focusName?: boolean
    /** The browser refused the family's files, so every preview here is a fallback face. */
    loadFailed?: boolean
    /** View mode: whether this reader's font list offers the family. */
    shown?: boolean
    showPending?: boolean
  }>(),
  { mode: 'edit', pickerUserFamilies: () => [], armRemove: false, focusName: false, loadFailed: false, shown: true, showPending: false },
)

const emit = defineEmits<{
  close: []
  save: [newName: string]
  remove: []
  addFiles: []
  updateFile: [fontId: number, data: { weight: number; style: FontStyle }]
  removeFile: [fontId: number]
  'update:shown': [shown: boolean]
}>()

const { t } = useI18n()
const { styleSummaryText, fileCountSummary, fileDetail } = useFontLabels()

const REMOVE_ACTION = 'remove'

const nameDraft = ref('')
const paper = ref<PreviewPaper>('app')
const editingFileId = ref<number | null>(null)
const editWeight = ref(400)
const editStyle = ref<FontStyle>('normal')
const confirmingFileId = ref<number | null>(null)

watch(
  () => [props.open, props.family?.name] as const,
  () => {
    nameDraft.value = props.family?.name ?? ''
    editingFileId.value = null
    confirmingFileId.value = null
  },
  { immediate: true },
)

const nameInput = ref<HTMLInputElement | null>(null)

// The sheet focuses its first control as it opens; the name field takes focus after that settles.
watch(
  () => props.open && props.focusName,
  async (focus) => {
    if (!focus) return
    await nextTick()
    requestAnimationFrame(() => requestAnimationFrame(() => nameInput.value?.select()))
  },
)

const name = computed(() => props.family?.name ?? '')
const files = computed<UserFont[]>(() => props.family?.variants ?? [])
const variants = computed(() => familyVariants(files.value))
const isVariable = computed(() => files.value.some(isVariableFont))
const trimmedDraft = computed(() => nameDraft.value.trim())
const dirty = computed(() => props.family !== null && trimmedDraft.value !== '' && trimmedDraft.value !== props.family.name)

/** Saved reader settings name a family by its CSS name, so a rename that changes it strands them. */
const renameStrandsBooks = computed(
  () =>
    dirty.value &&
    (props.usage.books > 0 || props.usage.defaults > 0) &&
    fontCssFamilyGroupName(trimmedDraft.value, props.scope) !== fontCssFamilyGroupName(name.value, props.scope),
)

const editable = computed(() => props.mode === 'edit' && !props.readonly)

const removeConsequence = computed(() => {
  const parts: string[] = []
  if (props.perspective === 'server') {
    if (props.usage.books > 0) {
      parts.push(t('settings.admin.serverFonts.sheet.removeConsequenceBooks', { books: props.usage.books, readers: props.usage.readers }))
    }
  } else {
    if (props.usage.books > 0) parts.push(t('settings.reader.fonts.library.removeConsequenceBooks', { count: props.usage.books }))
    if (props.usage.defaults > 0) parts.push(t('settings.reader.fonts.library.removeConsequenceDefault'))
  }
  parts.push(t('settings.admin.serverFonts.sheet.removeConsequenceFiles', { count: files.value.length }))
  return parts.join(' ')
})

const filesUsed = computed(() =>
  props.perspective === 'server'
    ? t('settings.admin.serverFonts.sheet.filesUsed', { count: formatNumber(props.totalFiles), max: formatNumber(props.maxFiles) })
    : t('settings.reader.fonts.library.filesUsed', { count: formatNumber(props.totalFiles), max: formatNumber(props.maxFiles) }),
)

function handleShown(shown: boolean) {
  emit('update:shown', shown)
}

const weightOptions = computed(() => FONT_WEIGHTS.map((weight) => ({ value: weight, label: `${t(FONT_WEIGHT_LABEL_KEYS[weight]!)} (${weight})` })))

function handleSave() {
  if (dirty.value) emit('save', trimmedDraft.value)
  else emit('close')
}
function handleCancel() {
  emit('close')
}
function handleRemove() {
  emit('remove')
}
function handleAddFiles() {
  emit('addFiles')
}
function handlePaper(next: PreviewPaper) {
  paper.value = next
}

function startEditFile(font: UserFont) {
  confirmingFileId.value = null
  editingFileId.value = font.id
  editWeight.value = font.weight
  editStyle.value = font.style
}
function cancelEditFile() {
  editingFileId.value = null
}
function saveEditFile() {
  const id = editingFileId.value
  editingFileId.value = null
  if (id !== null) emit('updateFile', id, { weight: editWeight.value, style: editStyle.value })
}
function askRemoveFile(font: UserFont) {
  editingFileId.value = null
  confirmingFileId.value = font.id
}
function cancelRemoveFile() {
  confirmingFileId.value = null
}
function confirmRemoveFile() {
  const id = confirmingFileId.value
  confirmingFileId.value = null
  if (id !== null) emit('removeFile', id)
}
</script>

<template>
  <SettingsEditorSheet
    :open="open && family !== null"
    :title="name"
    :description="t('settings.admin.serverFonts.sheet.description', { name })"
    :dirty="dirty"
    :busy="busy"
    :removable="editable"
    :remove-label="t('settings.admin.serverFonts.sheet.removeLabel')"
    :remove-confirm="
      perspective === 'server'
        ? t('settings.admin.serverFonts.sheet.removeQuestion', { name })
        : t('settings.reader.fonts.library.removeQuestion', { name })
    "
    :remove-consequence="removeConsequence"
    :armed-action="armRemove ? REMOVE_ACTION : null"
    @save="handleSave"
    @cancel="handleCancel"
    @remove="handleRemove"
  >
    <template #status>
      <div class="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span v-if="isVariable" class="settings-state-pill">{{ t('settings.admin.serverFonts.sheet.variable') }}</span>
        <span>{{ styleSummaryText(files) }} · {{ fileCountSummary(files) }}</span>
      </div>
    </template>

    <template v-if="family">
      <section>
        <FontPagePreview :css-family-name="family.cssFamilyName" :paper="paper" @update:paper="handlePaper">
          <p class="truncate text-[44px] leading-[52px] text-foreground" :style="{ fontFamily: `'${family.cssFamilyName}', serif` }">
            {{ family.name }}
          </p>
          <p
            v-if="loadFailed"
            role="alert"
            class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2.5 text-xs text-foreground"
          >
            <TriangleAlert :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
            {{ t('settings.admin.serverFonts.sheet.loadFailedNote') }}
          </p>
        </FontPagePreview>
      </section>

      <section class="flex flex-col gap-2.5">
        <div class="flex items-baseline justify-between gap-3">
          <span class="settings-group-label mb-0">{{ t('settings.admin.serverFonts.sheet.styles') }}</span>
          <span class="text-xs text-muted-foreground">{{ t('settings.admin.serverFonts.sheet.stylesHint') }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="variant in variants"
            :key="`${variant.weight}:${variant.style}`"
            class="flex h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground"
            :style="{ fontFamily: `'${family.cssFamilyName}', serif`, fontWeight: variant.weight, fontStyle: variant.style }"
            >{{ fontVariantLabel(variant, t) }}</span
          >
        </div>
        <p v-if="variants.length === 1" class="text-xs text-muted-foreground">
          {{ t('settings.admin.serverFonts.sheet.singleStyleNote', { style: fontVariantLabel(variants[0]!, t) }) }}
        </p>
      </section>

      <section class="flex flex-col gap-2.5">
        <span class="settings-group-label mb-0">{{ t('settings.admin.serverFonts.sheet.inReader') }}</span>
        <ReaderFontPickerPreview :server-families="pickerServerFamilies" :user-families="pickerUserFamilies" :selected="family" />
        <p class="text-xs text-muted-foreground">
          {{
            perspective === 'server'
              ? t('settings.admin.serverFonts.sheet.inReaderHint', { name: family.name })
              : t('settings.reader.fonts.library.inReaderHint', { name: family.name })
          }}
        </p>
      </section>

      <section class="flex flex-col gap-2.5">
        <div class="flex items-baseline justify-between gap-3">
          <span class="settings-group-label mb-0">{{ t('settings.admin.serverFonts.sheet.files') }}</span>
          <span v-if="mode === 'edit'" class="text-xs text-muted-foreground tabular-nums">{{ filesUsed }}</span>
        </div>
        <ul class="settings-card">
          <li v-for="font in files" :key="font.id" class="bg-card px-3.5 py-2.5" data-testid="font-family-file">
            <div class="flex items-center gap-3">
              <span
                class="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-[9.5px] font-bold tracking-wide text-muted-foreground uppercase"
                aria-hidden="true"
                >{{ font.format }}</span
              >
              <div class="min-w-0 flex-1">
                <p class="text-[13.5px] leading-[19px] font-medium break-all text-foreground">{{ font.originalFileName }}</p>
                <p class="text-[12.5px] leading-[18px] text-muted-foreground">{{ fileDetail(font) }}</p>
              </div>
              <span class="shrink-0 text-[12.5px] text-muted-foreground tabular-nums max-sm:hidden">{{ formatBytes(font.fileSize) }}</span>
              <DropdownMenu v-if="editable">
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    :aria-label="t('settings.admin.serverFonts.sheet.fileActions', { name: font.originalFileName })"
                  >
                    <MoreHorizontal :size="16" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-56">
                  <DropdownMenuItem @click="startEditFile(font)">
                    <Pencil />
                    {{ t('settings.admin.serverFonts.sheet.changeStyle') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" @click="askRemoveFile(font)">
                    <Trash2 />
                    {{ t('settings.admin.serverFonts.sheet.removeFile') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div v-if="editingFileId === font.id" class="mt-2.5 flex flex-wrap items-end gap-2 ps-11">
              <label class="flex flex-col gap-1 text-xs text-muted-foreground">
                {{ t('settings.admin.serverFonts.sheet.weight') }}
                <select v-model.number="editWeight" class="select-field h-8 text-sm">
                  <option v-for="option in weightOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label class="flex flex-col gap-1 text-xs text-muted-foreground">
                {{ t('settings.admin.serverFonts.sheet.style') }}
                <select v-model="editStyle" class="select-field h-8 text-sm">
                  <option value="normal">{{ t('settings.reader.fonts.styleNormal') }}</option>
                  <option value="italic">{{ t('settings.reader.fonts.styleItalic') }}</option>
                </select>
              </label>
              <Button size="sm" type="button" @click="saveEditFile">{{ t('common.save') }}</Button>
              <Button size="sm" variant="outline" type="button" @click="cancelEditFile">{{ t('common.cancel') }}</Button>
            </div>

            <div
              v-if="confirmingFileId === font.id"
              role="alert"
              class="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 ms-11"
            >
              <p class="min-w-0 flex-1 text-xs text-foreground">{{ t('settings.admin.serverFonts.sheet.removeFileQuestion') }}</p>
              <Button size="sm" variant="destructive" type="button" @click="confirmRemoveFile">{{
                t('settings.admin.serverFonts.sheet.removeFile')
              }}</Button>
              <Button size="sm" variant="outline" type="button" @click="cancelRemoveFile">{{ t('common.cancel') }}</Button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="mode === 'edit'" class="flex flex-col gap-2">
        <label for="font-family-name" class="settings-group-label mb-0">{{ t('settings.admin.serverFonts.sheet.name') }}</label>
        <input id="font-family-name" ref="nameInput" v-model="nameDraft" class="input-field h-9 w-full" :disabled="readonly" maxlength="200" />
        <p class="text-xs text-muted-foreground">
          {{ perspective === 'server' ? t('settings.admin.serverFonts.sheet.nameHint') : t('settings.reader.fonts.library.nameHint') }}
        </p>
        <p v-if="dirty && perspective === 'server' && usage.hidden > 0" class="flex items-start gap-1.5 text-xs text-muted-foreground">
          <EyeOff :size="13" class="mt-0.5 shrink-0" aria-hidden="true" />
          {{ t('settings.admin.serverFonts.sheet.nameHiddenWarning', { count: usage.hidden, name: family.name }) }}
        </p>
        <p v-if="renameStrandsBooks" class="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert :size="13" class="mt-0.5 shrink-0" aria-hidden="true" />
          {{ t('settings.admin.serverFonts.sheet.nameBooksWarning', { count: usage.books }) }}
        </p>
      </section>

      <section v-if="perspective === 'server'" class="flex flex-col gap-2.5">
        <span class="settings-group-label mb-0">{{ t('settings.admin.serverFonts.sheet.readers') }}</span>
        <dl class="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-card">
          <div class="flex flex-col gap-0.5 px-4 py-3">
            <dt class="order-2 text-[12.5px] text-muted-foreground">
              {{ t('settings.admin.serverFonts.sheet.stats.books', { count: usage.books }) }}
            </dt>
            <dd class="order-1 text-[22px] leading-[26px] font-semibold tracking-tight tabular-nums">{{ formatNumber(usage.books) }}</dd>
          </div>
          <div class="flex flex-col gap-0.5 border-s border-border px-4 py-3">
            <dt class="order-2 text-[12.5px] text-muted-foreground">
              {{ t('settings.admin.serverFonts.sheet.stats.defaults', { count: usage.defaults }) }}
            </dt>
            <dd class="order-1 text-[22px] leading-[26px] font-semibold tracking-tight tabular-nums">{{ formatNumber(usage.defaults) }}</dd>
          </div>
          <div class="flex flex-col gap-0.5 border-s border-border px-4 py-3">
            <dt class="order-2 text-[12.5px] text-muted-foreground">
              {{ t('settings.admin.serverFonts.sheet.stats.hidden', { count: usage.hidden }) }}
            </dt>
            <dd class="order-1 text-[22px] leading-[26px] font-semibold tracking-tight tabular-nums">{{ formatNumber(usage.hidden) }}</dd>
          </div>
        </dl>
        <p class="text-xs text-muted-foreground">{{ t('settings.admin.serverFonts.sheet.readersPrivacy') }}</p>
      </section>
    </template>

    <template v-if="editable" #actions>
      <Button size="sm" variant="outline" type="button" :disabled="busy" @click="handleAddFiles">
        <FileUp :size="14" aria-hidden="true" />
        {{ t('settings.admin.serverFonts.menu.addFiles') }}
      </Button>
    </template>

    <!-- A server font on a reader's own page: nothing to save, only whether their list offers it. -->
    <template v-if="mode === 'view'" #footer="{ requestClose }">
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex min-w-0 flex-1 items-center gap-3 text-sm text-foreground">
          <ToggleSwitch
            :model-value="shown"
            :disabled="showPending || readonly"
            :aria-label="t('settings.reader.fonts.library.showInReader')"
            @update:model-value="handleShown"
          />
          {{ t('settings.reader.fonts.library.showInReader') }}
        </label>
        <Button size="sm" variant="outline" type="button" @click="requestClose">{{ t('common.close') }}</Button>
      </div>
    </template>
  </SettingsEditorSheet>
</template>
