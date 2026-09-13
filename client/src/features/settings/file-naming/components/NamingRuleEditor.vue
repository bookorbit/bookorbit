<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, ChevronLeft, CornerDownRight, File, FolderOpen, Plus, RotateCcw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import AppIcon from '@/components/AppIcon.vue'
import PatternInput from './PatternInput.vue'
import PatternTokenPalette from './PatternTokenPalette.vue'
import PatternRecipeStrip from './PatternRecipeStrip.vue'
import type { NamingRule } from '../lib/naming-rules'

const props = defineProps<{
  rule: NamingRule
  name: string
  icon: string
  pattern: string
  inherited: boolean
  dirty: boolean
  error: string
  scopeSummary: string
  inheritedFromName: string
  sanitize: boolean
}>()

const emit = defineEmits<{
  'update:pattern': [value: string]
  addOverride: []
  removeOverride: []
  resetToShipped: []
  openHelp: []
  back: []
}>()

const { t } = useI18n()

const field = ref<InstanceType<typeof PatternInput> | null>(null)

const fieldId = 'file-naming-pattern'
const hintId = `${fieldId}-hint`
const errorId = `${fieldId}-error`

const describedBy = computed(() => (props.error ? `${hintId} ${errorId}` : hintId))
const isFolderMode = computed(() => props.rule.organizationMode === 'book_per_folder')
const canEdit = computed(() => !props.inherited)

// Mirrors the pill tokens the rest of the app uses for organization mode.
const organizationBadgeClass = computed(() =>
  isFolderMode.value
    ? 'border-[var(--pill-folder-as-book)]/40 bg-[var(--pill-folder-as-book)]/10 text-[var(--pill-folder-as-book)]'
    : 'border-[var(--pill-file-as-book)]/40 bg-[var(--pill-file-as-book)]/10 text-[var(--pill-file-as-book)]',
)

const ruleHint = computed(() => {
  if (props.rule.kind === 'library') return t('settings.reader.fileNaming.libraryRuleHint', { base: props.inheritedFromName })
  if (props.rule.globalKey === 'download') return t('settings.reader.fileNaming.downloadPatternHint')
  return isFolderMode.value ? t('settings.reader.fileNaming.folderAsBookDefaultHint') : t('settings.reader.fileNaming.fileAsBookDefaultHint')
})

function handlePattern(value: string) {
  emit('update:pattern', value)
}

function handleInsert(text: string, caretOffset?: number) {
  field.value?.insertAtCaret(text, caretOffset)
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

function handleHelp() {
  emit('openHelp')
}

function handleBack() {
  emit('back')
}
</script>

<template>
  <div class="flex min-w-0 flex-col">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3.5 py-3 md:flex-nowrap md:items-start md:px-5 md:py-4">
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        class="md:hidden"
        :aria-label="t('settings.reader.fileNaming.backToRules')"
        @click="handleBack"
      >
        <ChevronLeft :size="18" aria-hidden="true" />
      </Button>

      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
        <AppIcon :icon="icon" fallback="File" :size="17" aria-hidden="true" />
      </span>

      <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 class="flex flex-wrap items-center gap-2 font-serif text-base font-semibold tracking-tight text-foreground md:text-[17px]">
          {{ name }}
          <Badge v-if="rule.kind === 'library'" variant="outline" class="gap-1" :class="organizationBadgeClass">
            <FolderOpen v-if="isFolderMode" :size="11" aria-hidden="true" />
            <File v-else :size="11" aria-hidden="true" />
            {{ isFolderMode ? t('settings.reader.fileNaming.orgFolderAsBook') : t('settings.reader.fileNaming.orgFileAsBook') }}
          </Badge>
          <Badge v-if="rule.kind === 'library'" :variant="inherited ? 'outline' : 'secondary'">
            {{ inherited ? t('settings.reader.fileNaming.badgeInherits') : t('settings.reader.fileNaming.badgeCustom') }}
          </Badge>
          <Badge v-if="dirty" variant="secondary" class="gap-1">
            <span aria-hidden="true" class="size-1.5 rounded-full bg-warning" />
            {{ t('settings.reader.fileNaming.badgeUnsaved') }}
          </Badge>
        </h2>
        <p :id="hintId" class="w-full text-xs leading-relaxed text-muted-foreground">{{ ruleHint }}</p>
      </div>

      <Button variant="secondary" size="sm" type="button" class="hidden shrink-0 md:inline-flex" @click="handleHelp">
        <BookOpen :size="13" aria-hidden="true" />
        {{ t('settings.reader.fileNaming.examples') }}
      </Button>
    </header>

    <div class="@container flex flex-col gap-4 px-3.5 py-4 md:px-5">
      <div
        v-if="inherited"
        class="flex flex-col gap-2.5 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
      >
        <CornerDownRight :size="15" class="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        <p class="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.reader.fileNaming.inheritsNotice', { base: inheritedFromName }) }}
        </p>
        <Button variant="outline" size="sm" type="button" class="shrink-0 self-start sm:self-auto" @click="handleAddOverride">
          <Plus :size="12" aria-hidden="true" />
          {{ t('settings.reader.fileNaming.addOverride') }}
        </Button>
      </div>

      <div>
        <div class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <label :for="fieldId" class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.reader.fileNaming.patternLabel') }}
          </label>
          <Badge v-if="inherited" variant="outline">{{ t('settings.reader.fileNaming.readOnlyFromGlobal') }}</Badge>
          <span class="grow" />
          <Button v-if="rule.kind === 'library' && !inherited" variant="ghost" size="sm" type="button" @click="handleRemoveOverride">
            <RotateCcw :size="12" aria-hidden="true" />
            {{ t('settings.reader.fileNaming.useGlobalDefault') }}
          </Button>
          <Button
            v-else-if="rule.kind === 'global'"
            variant="ghost"
            size="sm"
            type="button"
            :disabled="pattern === rule.shippedDefault"
            @click="handleReset"
          >
            <RotateCcw :size="12" aria-hidden="true" />
            {{ t('settings.reader.fileNaming.resetToShipped') }}
          </Button>
        </div>

        <PatternInput
          :id="fieldId"
          ref="field"
          :model-value="pattern"
          :readonly="inherited"
          :invalid="!!error"
          :described-by="describedBy"
          :placeholder="rule.shippedDefault"
          @update:model-value="handlePattern"
        />

        <p v-if="error" :id="errorId" role="alert" class="mt-1.5 text-xs font-medium text-destructive">{{ error }}</p>
        <p v-else class="mt-1.5 text-[11px] text-muted-foreground">{{ scopeSummary }}</p>
      </div>

      <PatternTokenPalette v-if="canEdit" @insert="handleInsert" />

      <PatternRecipeStrip
        v-if="canEdit"
        :target="rule.target"
        :organization-mode="rule.organizationMode"
        :current-pattern="pattern"
        :sanitize="sanitize"
        @apply="handlePattern"
      />

      <Button variant="secondary" size="sm" type="button" class="self-start md:hidden" @click="handleHelp">
        <BookOpen :size="13" aria-hidden="true" />
        {{ t('settings.reader.fileNaming.examples') }}
      </Button>
    </div>
  </div>
</template>
