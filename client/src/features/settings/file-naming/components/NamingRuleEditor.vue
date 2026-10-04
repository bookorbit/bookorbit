<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, CornerDownRight, Copy, File, FolderOpen, Info, MoreHorizontal, Plus, RotateCcw, Undo2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import AppIcon from '@/components/AppIcon.vue'
import { copyToClipboard } from '@/lib/clipboard'
import { formatList, formatListParts } from '@/i18n/formatters'
import PatternInput from './PatternInput.vue'
import PatternInsertBar from './PatternInsertBar.vue'
import PatternRecipeMenu from './PatternRecipeMenu.vue'
import NamingResultPanel from './NamingResultPanel.vue'
import { PREVIEW_BOOKS, type PreviewBookId } from '../lib/preview-books'
import type { PreviewCaseId } from '../lib/pattern-preview'
import type { NamingRule, NamingRuleId } from '../lib/naming-rules'

/** Another rule the header names, rendered as a link that selects it. */
export interface RuleLink {
  id: NamingRuleId
  name: string
}

const props = defineProps<{
  rule: NamingRule
  name: string
  icon: string
  /** The pattern being edited, or a preview pattern that trails it while typing on phones. */
  pattern: string
  previewPattern: string
  inherited: boolean
  dirty: boolean
  error: string
  sanitize: boolean
  previewBookId: PreviewBookId
  caseId: PreviewCaseId
  /** For a global upload default: the libraries that follow it. */
  usedBy: RuleLink[]
  /** For a library: the global default it follows or overrides. */
  base: RuleLink | null
  /** Libraries this pattern governs that rename files when a book's details are saved. */
  renamingLibraries: string[]
  canBulkRename: boolean
}>()

const emit = defineEmits<{
  'update:pattern': [value: string]
  'update:previewBookId': [value: PreviewBookId]
  'update:caseId': [value: PreviewCaseId]
  addOverride: []
  removeOverride: []
  resetToShipped: []
  openExamples: []
  select: [id: NamingRuleId]
  back: []
  completing: [value: boolean]
}>()

const { t } = useI18n()

const field = ref<InstanceType<typeof PatternInput> | null>(null)

const fieldId = 'file-naming-pattern'
const scopeId = `${fieldId}-scope`
const hintId = `${fieldId}-hint`
const errorId = `${fieldId}-error`

const isLibrary = computed(() => props.rule.kind === 'library')
const isFolderMode = computed(() => props.rule.organizationMode === 'book_per_folder')
const isCustom = computed(() => isLibrary.value && !props.inherited)
const isDownload = computed(() => props.rule.target === 'download')
const describedBy = computed(() => [scopeId, props.error ? errorId : props.inherited ? '' : hintId].filter(Boolean).join(' '))
const sampleValues = computed(() => PREVIEW_BOOKS[props.previewBookId].metadata)
const usedByParts = computed(() => formatListParts(props.usedBy.map((link) => link.name)))

// Mirrors the pill tokens the rest of the app uses for organization mode.
const organizationBadgeClass = computed(() =>
  isFolderMode.value
    ? 'border-[var(--pill-folder-as-book)]/40 bg-[var(--pill-folder-as-book)]/10 text-[var(--pill-folder-as-book)]'
    : 'border-[var(--pill-file-as-book)]/40 bg-[var(--pill-file-as-book)]/10 text-[var(--pill-file-as-book)]',
)

/** Index into `usedBy` for an element part of the formatted list. */
function linkAt(partIndex: number): RuleLink | undefined {
  const elementIndex = usedByParts.value.slice(0, partIndex + 1).filter((part) => part.type === 'element').length - 1
  return props.usedBy[elementIndex]
}

function handlePattern(value: string) {
  emit('update:pattern', value)
}

function handleInsert(text: string, caretOffset?: number) {
  field.value?.insertAtCaret(text, caretOffset)
}

function handleCompleting(value: boolean) {
  emit('completing', value)
}

function handleBook(value: PreviewBookId) {
  emit('update:previewBookId', value)
}

function handleCase(value: PreviewCaseId) {
  emit('update:caseId', value)
}

function handleAddOverride() {
  emit('addOverride')
}

function handleRemoveOverride() {
  emit('removeOverride')
}

function handleReset() {
  emit('resetToShipped')
}

function handleExamples() {
  emit('openExamples')
}

function handleBack() {
  emit('back')
}

function handleSelectBase() {
  if (props.base) emit('select', props.base.id)
}

function handleSelectLink(partIndex: number) {
  const link = linkAt(partIndex)
  if (link) emit('select', link.id)
}

async function handleCopyPattern() {
  const copied = await copyToClipboard(props.pattern)
  if (copied) toast.success(t('settings.reader.fileNaming.patternCopied'))
  else toast.error(t('settings.reader.fileNaming.copyPatternFailed'))
}
</script>

<template>
  <div class="flex min-w-0 flex-col">
    <header class="flex items-start gap-2.5 border-b border-border px-3.5 py-3 @2xl/naming:gap-3 @2xl/naming:px-5 @2xl/naming:py-4">
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        class="-ms-1.5 @2xl/naming:hidden"
        :aria-label="t('settings.reader.fileNaming.backToRules')"
        @click="handleBack"
      >
        <ChevronLeft :size="18" aria-hidden="true" />
      </Button>

      <span class="hidden size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary @2xl/naming:grid">
        <AppIcon :icon="icon" fallback="File" :size="17" aria-hidden="true" />
      </span>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 class="font-serif text-base font-semibold tracking-tight text-foreground @2xl/naming:text-[17px]">{{ name }}</h2>
          <Badge v-if="isLibrary" variant="outline" class="gap-1" :class="organizationBadgeClass">
            <FolderOpen v-if="isFolderMode" :size="11" aria-hidden="true" />
            <File v-else :size="11" aria-hidden="true" />
            {{ isFolderMode ? t('settings.reader.fileNaming.orgFolderAsBook') : t('settings.reader.fileNaming.orgFileAsBook') }}
          </Badge>
          <Badge v-if="isCustom" variant="secondary">{{ t('settings.reader.fileNaming.badgeCustom') }}</Badge>
          <Badge v-if="dirty" variant="secondary" class="gap-1.5">
            <span aria-hidden="true" class="size-1.5 rounded-full bg-warning" />
            {{ t('settings.reader.fileNaming.badgeUnsaved') }}
          </Badge>
        </div>

        <p :id="scopeId" class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          <template v-if="isDownload">{{ t('settings.reader.fileNaming.scopeDownload') }}</template>
          <i18n-t
            v-else-if="isLibrary && base"
            :keypath="inherited ? 'settings.reader.fileNaming.followsBase' : 'settings.reader.fileNaming.libraryRuleHint'"
            scope="global"
          >
            <template #base>
              <button
                type="button"
                class="text-foreground underline decoration-foreground/30 underline-offset-2 hover:text-primary hover:decoration-current"
                @click="handleSelectBase"
              >
                {{ base.name }}
              </button>
            </template>
          </i18n-t>
          <i18n-t v-else-if="usedBy.length" keypath="settings.reader.fileNaming.usedBy" scope="global">
            <template #libraries>
              <template v-for="(part, index) in usedByParts" :key="index"
                ><button
                  v-if="part.type === 'element'"
                  type="button"
                  class="text-foreground underline decoration-foreground/30 underline-offset-2 hover:text-primary hover:decoration-current"
                  @click="handleSelectLink(index)"
                >
                  {{ part.value }}</button
                ><template v-else>{{ part.value }}</template></template
              >
            </template>
          </i18n-t>
          <template v-else>{{ t('settings.reader.fileNaming.scopeGlobalNone') }}</template>
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <PatternRecipeMenu
          v-if="!inherited"
          :target="rule.target"
          :organization-mode="rule.organizationMode"
          :current-pattern="pattern"
          :sanitize="sanitize"
          :preview-book-id="previewBookId"
          @apply="handlePattern"
          @open-examples="handleExamples"
        />
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="icon-sm" type="button" :aria-label="t('settings.editor.moreActions')">
              <MoreHorizontal :size="16" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-56">
            <DropdownMenuItem v-if="rule.kind === 'global'" :disabled="pattern === rule.shippedDefault" @select="handleReset">
              <RotateCcw aria-hidden="true" />
              {{ t('settings.reader.fileNaming.resetToShipped') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-else-if="isCustom" @select="handleRemoveOverride">
              <Undo2 aria-hidden="true" />
              {{ t('settings.reader.fileNaming.useGlobalDefault') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-else @select="handleAddOverride">
              <Plus aria-hidden="true" />
              {{ t('settings.reader.fileNaming.addOverride') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="handleCopyPattern">
              <Copy aria-hidden="true" />
              {{ t('settings.reader.fileNaming.copyPattern') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

    <div class="@container flex flex-col gap-6 px-3.5 py-4 @2xl/naming:px-5 @2xl/naming:py-5">
      <div
        v-if="inherited"
        class="flex flex-col gap-2.5 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2.5 @md:flex-row @md:items-center @md:gap-3"
      >
        <CornerDownRight :size="15" class="hidden shrink-0 text-muted-foreground @md:block" aria-hidden="true" />
        <p class="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.reader.fileNaming.inheritsNotice', { base: base?.name ?? '' }) }}
        </p>
        <Button variant="outline" size="sm" type="button" class="shrink-0 self-start @md:self-auto" @click="handleAddOverride">
          <Plus :size="12" aria-hidden="true" />
          {{ t('settings.reader.fileNaming.addOverride') }}
        </Button>
      </div>

      <div>
        <div class="mb-1.5 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
          <label :for="fieldId" class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.reader.fileNaming.patternLabel') }}
          </label>
          <Badge v-if="inherited" variant="outline">{{ t('settings.reader.fileNaming.readOnlyFromGlobal') }}</Badge>
          <span class="grow" />
          <PatternInsertBar v-if="!inherited" :target="rule.target" :sample-values="sampleValues" @insert="handleInsert" />
        </div>

        <PatternInput
          :id="fieldId"
          ref="field"
          :model-value="pattern"
          lines
          :mode="rule.organizationMode"
          :target="rule.target"
          :readonly="inherited"
          :invalid="!!error"
          :described-by="describedBy"
          :placeholder="rule.shippedDefault"
          :sample-values="sampleValues"
          @update:model-value="handlePattern"
          @completing="handleCompleting"
        />

        <p v-if="error" :id="errorId" role="alert" class="mt-1.5 text-xs font-medium text-destructive">{{ error }}</p>
        <p v-else-if="!inherited && isDownload" :id="hintId" class="mt-1.5 text-[11px] text-muted-foreground">
          {{ t('settings.reader.fileNaming.downloadLineHint') }}
        </p>
        <i18n-t
          v-else-if="!inherited"
          :id="hintId"
          keypath="settings.reader.fileNaming.lineHint"
          tag="p"
          class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground"
          scope="global"
        >
          <template #enter><kbd class="rounded border border-border px-1 font-mono text-[10.5px]">Enter</kbd></template>
          <template #brace><kbd class="rounded border border-border px-1 font-mono text-[10.5px]">{</kbd></template>
        </i18n-t>
      </div>

      <NamingResultPanel
        :pattern="previewPattern"
        :target="rule.target"
        :mode="rule.organizationMode"
        :sanitize="sanitize"
        :preview-book-id="previewBookId"
        :case-id="caseId"
        :stale="!!error"
        @update:preview-book-id="handleBook"
        @update:case-id="handleCase"
      />

      <p v-if="renamingLibraries.length" class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          {{ t('settings.reader.fileNaming.renameNote', { libraries: formatList(renamingLibraries) }) }}
          <RouterLink
            v-if="canBulkRename"
            :to="{ name: 'tools-bulk-rename' }"
            class="ms-1 whitespace-nowrap text-foreground underline decoration-foreground/30 underline-offset-2 hover:text-primary hover:decoration-current"
          >
            {{ t('tools.header.bulkRename') }}
          </RouterLink>
        </span>
      </p>
    </div>
  </div>
</template>
